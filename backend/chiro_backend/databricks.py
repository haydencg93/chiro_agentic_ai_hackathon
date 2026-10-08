"""Unified-auth SQL statement transport with bounded, deadline-aware polling."""
import time
import httpx
from databricks.sdk import WorkspaceClient
from databricks.sdk.core import Config
from .runtime import remaining, DeadlineExceeded

class DataUnavailable(RuntimeError):
    pass

class DatabricksSQL:
    def __init__(self,settings):
        self.settings=settings
        self._client=None
    @property
    def client(self):
        if self._client is None:
            budget=remaining()
            self._client=WorkspaceClient(config=Config(profile=self.settings.profile,
                http_timeout_seconds=min(10,budget/4),retry_timeout_seconds=1))
            remaining()
        return self._client
    def request(self,method,path,body=None):
        workspace=self.client
        budget=remaining(45)
        try:
            with httpx.Client(timeout=min(10,budget/4)) as client:
                response=client.request(method,workspace.config.host.rstrip('/')+path,
                    headers=workspace.config.authenticate(),json=body)
            remaining()
            if response.status_code!=200:
                raise DataUnavailable(f'Databricks SQL HTTP {response.status_code}; a committed write may be safely retried using its stable ID')
            return response.json()
        except httpx.HTTPError as exc:
            raise DataUnavailable('Databricks SQL transport failed; retry resumes any committed action/outcome') from exc
    def query(self,statement,parameters=None):
        remaining()
        if not self.settings.warehouse_id:
            raise DataUnavailable('Set CHIRO_WAREHOUSE_ID to a verified SQL warehouse')
        response=self.request('POST','/api/2.0/sql/statements',{
            'warehouse_id':self.settings.warehouse_id,'statement':statement,
            'parameters':[{'name':k,'value':str(v),'type':'STRING'} for k,v in (parameters or {}).items()],
            'wait_timeout':'0s','row_limit':10000})
        deadline=time.monotonic()+min(45,remaining(45))
        while response['status']['state'] in ('PENDING','RUNNING'):
            if time.monotonic()>=deadline:
                # Do not extend an expired request to cancel; a write may finish remotely.
                raise DeadlineExceeded('SQL polling deadline reached; stable IDs permit safe persistence recovery')
            time.sleep(min(.25,max(0,deadline-time.monotonic())))
            remaining()
            response=self.request('GET',f'/api/2.0/sql/statements/{response["statement_id"]}')
        if response['status']['state']!='SUCCEEDED':
            raise DataUnavailable('Databricks SQL query failed; verify schema and permissions')
        manifest=response.get('manifest') or {}
        if manifest.get('truncated'):
            raise DataUnavailable('Query result exceeded the bounded result limit')
        names=[c['name'] for c in (manifest.get('schema') or {}).get('columns',[])]
        result=response.get('result') or {}
        rows=result.get('data_array') or []
        while result.get('next_chunk_internal_link'):
            result=self.request('GET',result['next_chunk_internal_link'])
            rows.extend(result.get('data_array') or [])
        remaining()
        return [dict(zip(names,row)) for row in rows]
    def table(self,name):
        return f'`{self.settings.catalog}`.`{self.settings.data_schema}`.`{name}`'
