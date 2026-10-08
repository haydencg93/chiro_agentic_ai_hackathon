import pytest
from fastapi.testclient import TestClient
from chiro_backend.app import create_app
from chiro_backend.config import Settings
from chiro_backend.tools import calculate_risk, DataTools
from chiro_backend.ledger import Ledger
from chiro_backend.service import RetentionService


def metric(**updates):
    row=dict(patient_id='PT1',as_of_date='2026-09-30',recent_visits=1,prior_visits=6,
             gap_days=60,mean_revenue=100,appointments=4,missed=2)
    row.update(updates)
    return calculate_risk(row)

class SyntheticTestTools:
    """Unit-test fixture only; the production app never loads fixture data."""
    def find_revenue_risk_patients(self): return [metric()]
    def calculate_revenue_at_risk(self,pid):
        if pid != 'PT1': raise KeyError(pid)
        return metric()
    def get_patient_history(self,pid):
        self.calculate_revenue_at_risk(pid)
        return {'patient':{'patient_id':pid,'first_name':'Test','last_name':'Patient'},'visits':[]}
    def get_appointment_behavior(self,pid): return {'recent_appointments':4,'missed_appointments':2}

@pytest.fixture
def client(tmp_path):
    service=RetentionService(SyntheticTestTools(),Ledger(str(tmp_path/'ledger.sqlite')))
    return TestClient(create_app(Settings(),service))

def test_risk_formula_and_insufficient_history():
    r=metric()
    assert r['score']==.65
    assert r['revenue_at_risk']==390
    assert metric(recent_visits=0,prior_visits=0,gap_days=None,appointments=0,missed=0)['score']==0
    assert metric(mean_revenue=0)['revenue_at_risk']==0

def test_healthy_patient():
    assert metric(recent_visits=6,prior_visits=6,gap_days=5,missed=0)['score']==0

def test_api_contract_approval_and_idempotence(client):
    assert client.get('/health').json()['databricks']=='not_checked'
    assert client.get('/api/cases').json()['cases'][0]['case_id']=='CASE-PT1'
    response=client.post('/api/agent/run',json={'patient_id':'PT1'})
    assert response.status_code==200
    c=response.json()['case']
    assert c['orchestration_mode']=='deterministic'
    assert c['status']=='AWAITING_APPROVAL'
    assert c['outcome'] is None
    assert client.post('/api/cases/CASE-PT1/run').json()['case']['action']==c['action']
    action_id=c['action']['action_id']
    result=client.post(f'/api/actions/{action_id}/approve')
    assert result.status_code==200
    outcome=result.json()['case']['outcome']
    assert outcome['status']=='SIMULATED'
    assert outcome['revenue_recovered']==0
    assert outcome['simulated_expected_recovery']>0
    assert client.post(f'/api/actions/{action_id}/approve').json()==result.json()
    assert client.post('/api/cases/CASE-PT1/reject').status_code==409
    assert client.get('/api/summary').json()['actions_executed']==0

def test_missing_and_rejection(client):
    assert client.get('/api/cases/absent').status_code==404
    assert client.post('/api/cases/CASE-PT1/approve').status_code==409
    client.post('/api/cases/CASE-PT1/run')
    rejected=client.post('/api/cases/CASE-PT1/reject').json()['case']
    assert rejected['status']=='REVIEW'
    assert rejected['outcome'] is None

def test_durable_ledger(tmp_path):
    path=str(tmp_path/'ledger.sqlite')
    service=RetentionService(SyntheticTestTools(),Ledger(path))
    c=service.run('PT1')
    assert RetentionService(SyntheticTestTools(),Ledger(path)).get('PT1')==c

def test_patient_id_is_parameterized():
    class RecordingSQL:
        def table(self,name): return name
        def query(self,statement,parameters=None):
            assert 'DROP TABLE' not in statement
            assert parameters['patient_id']=="'; DROP TABLE patients; --"
            return []
    with pytest.raises(KeyError):
        DataTools(RecordingSQL()).get_patient_history("'; DROP TABLE patients; --")

def test_config_rejects_sql_identifier():
    with pytest.raises(ValueError): Settings(catalog='workspace; DROP TABLE patients')

def test_unconfigured_readiness():
    client=TestClient(create_app(Settings(warehouse_id=None)))
    assert client.get('/health?check_databricks=true').status_code==503

def test_summary_uses_selected_recovery_and_counts_recorded_actions(tmp_path):
    service=RetentionService(SyntheticTestTools(),Ledger(str(tmp_path/'summary.sqlite')))
    selected=service.build_case(metric())
    selected.update(diagnosis={'category':'GENERAL_DISENGAGEMENT'}, status='AWAITING_APPROVAL',
        interventions=[{'expected_recovery':90,'selected':True},{'expected_recovery':200,'selected':False}],
        action={'status':'PENDING_APPROVAL'})
    unanalysed=service.build_case(metric(patient_id='PT2'))
    service.cases=lambda:[selected,unanalysed]
    summary=service.summary()
    assert summary['potentially_recoverable']==90
    assert summary['actions_recorded']==1 and summary['actions_executed']==0
    assert summary['awaiting_approval']==1
    assert summary['revenue_at_risk']==780 and summary['revenue_recovered']==0
