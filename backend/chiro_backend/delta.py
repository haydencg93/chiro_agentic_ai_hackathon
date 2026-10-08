"""Small Delta persistence adapter; no SQLite reads in normal operation."""
import json
from datetime import datetime, timezone
from decimal import Decimal
from .databricks import DataUnavailable
from .tool_models import Intervention

SCHEMAS = {
    'interventions': {
        'intervention_id':'STRING', 'intervention_type':'STRING', 'estimated_cost':'DECIMAL(18,2)',
        'description':'STRING', 'requires_approval':'BOOLEAN', 'active_flag':'BOOLEAN'},
    'agent_actions': {
        'action_id':'STRING', 'patient_id':'STRING', 'diagnosis':'STRING', 'diagnosis_confidence':'DOUBLE',
        'selected_intervention':'STRING', 'estimated_revenue_at_risk':'DECIMAL(18,2)',
        'expected_recovery':'DECIMAL(18,2)', 'estimated_cost':'DECIMAL(18,2)',
        'expected_net_value':'DECIMAL(18,2)', 'requires_approval':'BOOLEAN', 'status':'STRING',
        'model_name':'STRING', 'created_at':'TIMESTAMP',
        # Preserve the existing frontend response and concise tool audit across restarts.
        'case_json':'STRING'},
    'simulated_outcomes': {
        'outcome_id':'STRING', 'action_id':'STRING', 'patient_id':'STRING', 'reengaged':'BOOLEAN',
        'simulated_revenue_recovered':'DECIMAL(18,2)', 'simulation_method':'STRING', 'created_at':'TIMESTAMP'},
}

def utcnow():
    return datetime.now(timezone.utc).isoformat()

class DeltaLedger:
    persistence = 'databricks_delta'
    def __init__(self, sql):
        self.sql = sql
    def get(self, patient_id):
        rows=self.sql.query(f'SELECT case_json FROM {self.sql.table("agent_actions")} WHERE patient_id=:patient_id ORDER BY created_at DESC LIMIT 1',{'patient_id':patient_id})
        return json.loads(rows[0]['case_json']) if rows else None
    def all(self):
        rows=self.sql.query(f'SELECT case_json FROM {self.sql.table("agent_actions")} ORDER BY created_at DESC LIMIT 1000')
        return [json.loads(row['case_json']) for row in rows]
    def interventions(self):
        rows=self.sql.query(f'SELECT intervention_type, estimated_cost, requires_approval FROM {self.sql.table("interventions")} WHERE active_flag=true')
        result={}
        for row in rows:
            try:
                key=Intervention(row['intervention_type']).value
            except ValueError as exc:
                raise DataUnavailable('Delta intervention catalog contains an unregistered type') from exc
            cost=float(Decimal(str(row['estimated_cost'])))
            if cost<0:
                raise DataUnavailable('Invalid intervention cost')
            required=str(row['requires_approval']).lower()=='true'
            if key in result:
                raise DataUnavailable('Duplicate intervention catalog entry')
            result[key]={'estimated_cost':cost,'requires_approval':required}
        if 'NO_ACTION' not in result:
            raise DataUnavailable('Active NO_ACTION baseline is required')
        return result
    def merge(self, table, key, row, mutable=()):
        types=SCHEMAS[table]
        source=', '.join(f'CAST(:{name} AS {types[name]}) AS `{name}`' for name in row)
        columns=', '.join(f'`{name}`' for name in row)
        values=', '.join(f's.`{name}`' for name in row)
        update=('WHEN MATCHED THEN UPDATE SET '+', '.join(f't.`{name}`=s.`{name}`' for name in mutable)) if mutable else ''
        self.sql.query(f'''MERGE INTO {self.sql.table(table)} t USING (SELECT {source}) s
            ON t.`{key}`=s.`{key}` {update}
            WHEN NOT MATCHED THEN INSERT ({columns}) VALUES ({values})''',
            {k:str(v).lower() if isinstance(v,bool) else v for k,v in row.items()})
    def save(self, case):
        action=case.get('action')
        if not action:
            return  # DECIDE is not an ACT write.
        selected=next(i for i in case['interventions'] if i['selected'])
        action.setdefault('created_at',utcnow())
        outcome=case.get('outcome')
        if outcome:
            if action['status']!='EXECUTED':
                raise DataUnavailable('Cannot persist simulated outcome before action approval/execution')
            outcome.setdefault('created_at',utcnow())
        row=dict(action_id=action['action_id'],patient_id=case['patient']['patient_id'],
            diagnosis=case['diagnosis']['category'],diagnosis_confidence=case['diagnosis']['confidence'],
            selected_intervention=action['type'],estimated_revenue_at_risk=case['risk']['revenue_at_risk'],
            expected_recovery=selected['expected_recovery'],estimated_cost=selected['estimated_cost'],
            expected_net_value=selected['net_value'],requires_approval=action['requires_approval'],status=action['status'],
            model_name=(case.get('agent_run') or {}).get('model','databricks-gpt-oss-120b'),
            created_at=action['created_at'],case_json=json.dumps(case))
        # Immutable decision/economics; only approval status and audit payload update.
        outcome=case.get('outcome')
        if outcome:
            if action['status']!='EXECUTED':
                raise DataUnavailable('Cannot persist simulated outcome before action approval/execution')
            outcome.setdefault('created_at',utcnow())
            self.merge('simulated_outcomes','outcome_id',dict(outcome_id=outcome['outcome_id'],
                action_id=action['action_id'],patient_id=case['patient']['patient_id'],reengaged=outcome['reengaged'],
                simulated_revenue_recovered=outcome['simulated_revenue_recovered'],
                simulation_method=outcome['simulation_method'],created_at=outcome['created_at']))
        # Completed case JSON is acknowledged only AFTER its outcome is durable.
        self.merge('agent_actions','action_id',row,('status','case_json'))

def initialize_tables(sql):
    """Explicit, authorized setup only; never run at application startup."""
    from .agent_tools import CATALOG, approval_policy
    existing={r['tableName'] for r in sql.query(f'SHOW TABLES IN `{sql.settings.catalog}`.`{sql.settings.data_schema}`')}
    for name,fields in SCHEMAS.items():
        if name in existing:
            actual={r['col_name']:r['data_type'].upper().replace(' ','') for r in sql.query(f'DESCRIBE TABLE {sql.table(name)}') if not r['col_name'].startswith('#')}
            if any(actual.get(k)!=v for k,v in fields.items()):
                raise DataUnavailable(f'Existing {name} schema differs; no overwrite or automatic migration attempted')
        else:
            cols=', '.join(f'`{k}` {v}' for k,v in fields.items())
            sql.query(f'CREATE TABLE IF NOT EXISTS {sql.table(name)} ({cols}) USING DELTA')
    ledger=DeltaLedger(sql)
    for key,(label,prob,cost) in CATALOG.items():
        required,_=approval_policy(key,Decimal(cost),Decimal('0'))
        ledger.merge('interventions','intervention_id',dict(intervention_id=key.value,intervention_type=key.value,
            estimated_cost=cost,description=f'{label}. SIMULATED demo-v1 assumptions; not validated causal effects.',
            requires_approval=required,active_flag=True))
    return {name:sql.query(f'SELECT count(*) AS rows FROM {sql.table(name)}')[0]['rows'] for name in SCHEMAS}
