"""Read-only capability/schema/sample probe. Credentials are never printed."""
import argparse
import json
from concurrent.futures import ThreadPoolExecutor
from databricks.sdk import WorkspaceClient

parser=argparse.ArgumentParser()
parser.add_argument('--profile',required=True)
parser.add_argument('--warehouse-id')
args=parser.parse_args()
w=WorkspaceClient(profile=args.profile)

def inspect(name, function):
    try: return name, function()
    except Exception as exc: return name, {'available':False,'error_type':type(exc).__name__}

checks={
    'authentication':lambda: {'authenticated':bool(w.current_user.me().id),'host':w.config.host},
    'warehouses':lambda:[{'id':x.id,'name':x.name,'state':str(x.state),'serverless':x.enable_serverless_compute} for x in w.warehouses.list()],
    'jobs':lambda:[{'id':x.job_id,'name':x.settings.name} for x in w.jobs.list(limit=10)],
    'endpoints':lambda:[{'name':x.name,'task':str(x.task),'state':x.state.as_dict() if x.state else None,
                        'entities':[e.entity_name for e in (x.config.served_entities or [])] if x.config else []} for x in w.serving_endpoints.list()],
    'tables':lambda:[{'name':x.full_name,'format':str(x.data_source_format),
                     'columns':[{'name':c.name,'type':c.type_text} for c in (x.columns or [])]} for x in w.tables.list(catalog_name='workspace',schema_name='chiro_hackathon')],
    'mlflow_experiments':lambda:{'available':True,'count':len(list(w.experiments.list_experiments(max_results=10)))},
}
with ThreadPoolExecutor(max_workers=4) as pool:
    results=dict(pool.map(lambda item:inspect(*item),checks.items()))
if args.warehouse_id:
    from chiro_backend.config import Settings
    from chiro_backend.databricks import DatabricksSQL
    sql=DatabricksSQL(Settings(profile=args.profile,warehouse_id=args.warehouse_id))
    samples={}
    for t in results.get('tables',[]):
        if not isinstance(t,dict) or 'name' not in t: continue
        name=t['name'].split('.')[-1]
        samples[name]=inspect(name,lambda:sql.query(f"SELECT * FROM {sql.table(name)} LIMIT 2"))[1]
    results['samples']=samples
print(json.dumps(results,indent=2,default=str))
