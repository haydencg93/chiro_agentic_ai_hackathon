"""Focused unit fixtures; production never loads these mocked model replies."""
import json
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from chiro_backend.agent import RevenueRescueAgent, AgentFailure, public_text
from chiro_backend.agent_tools import AgentToolSession, ToolPolicyError, simulate_economics, native_tools, available_tools
from chiro_backend.app import create_app
from chiro_backend.config import Settings
from chiro_backend.ledger import Ledger
from chiro_backend.service import RetentionService
from chiro_backend.tools import DataTools, calculate_risk
from chiro_backend.tool_models import PatientArguments, InterventionArguments, AppointmentBehavior
from chiro_backend.schemas import Case
from chiro_backend.runtime import ModelPacer

class FixtureTools:
    def require_patient(self,pid):
        if pid!='PT1': raise KeyError(pid)
        return {'patient_id':'PT1','age_band':'45-54'}
    def calculate_revenue_at_risk(self,pid):
        self.require_patient(pid)
        return calculate_risk(dict(patient_id=pid,as_of_date='2026-10-01',gap_days='110',recent_visits='0',prior_visits='4',
                                   mean_revenue='99.4375',appointments='1',missed='1'))
    def get_appointment_behavior(self,pid):
        self.require_patient(pid)
        return AppointmentBehavior(as_of_date='2026-10-01',recent_appointments='1',missed_appointments='1',missed_rate=1).model_dump(mode='json')
    def get_patient_history(self,pid):
        return {'patient':self.require_patient(pid),'visits':[], 'visits_returned':0,'history_limit':100}
    def find_revenue_risk_patients(self): return [self.calculate_revenue_at_risk('PT1')]

class FixtureModel:
    def __init__(self,intervention='SCHEDULING_ASSISTANCE',extra_history=False):
        self.turn=0
        self.intervention=intervention
        self.extra_history=extra_history
        self.inputs=[]
    def complete(self,messages,tools,timeout):
        self.turn+=1
        self.inputs.append(json.loads(json.dumps(messages)))
        snapshot=json.loads(messages[1]['content'])['initial_snapshot']
        refs=[e['evidence_id'] for e in snapshot['evidence'] if e['tool']=='calculate_revenue_at_risk' and e['field'] in ('gap_days','prior_visits')]
        def call(name,**args):
            return {'tool_calls':[{'id':f'call-{self.turn}','type':'function','function':{
                'name':name,'arguments':json.dumps({'patient_id':'PT1',**args})}}],
                'content':[{'type':'reasoning','text':'PRIVATE_FIXTURE_REASONING'}]}
        if self.extra_history and self.turn==1:
            return call('get_additional_visit_history')
        if not any(m['role']=='tool' and 'simulations' in json.loads(m['content']) for m in messages):
            return call('diagnose_and_simulate',diagnosis='VISIT_FREQUENCY_DECLINE',confidence=.7,
                evidence_ids=refs,rationale='Observed four prior visits and no recent visits with a 110-day gap.',
                interventions=['NO_ACTION',self.intervention] if self.intervention!='NO_ACTION' else ['NO_ACTION','STAFF_OUTREACH'])
        results=next(json.loads(m['content'])['simulations'] for m in messages if m['role']=='tool' and 'simulations' in json.loads(m['content']))
        return call('select_intervention',intervention=self.intervention,evidence_ids=refs,
            simulation_ids=[r['simulation_id'] for r in results],
            rationale='Compared Python-computed scenario economics and the observed visit decline; selected an appropriate operational option.')

def make_service(tmp_path,model):
    tools=FixtureTools()
    service=RetentionService(tools,Ledger(str(tmp_path/'ledger.sqlite')))
    service.agent=RevenueRescueAgent(tools,service,model,pacer=ModelPacer(interval=0))
    return service

@pytest.mark.parametrize('payload',[{'patient_id':1},{'patient_id':'PT1','approved':True},{'patient_id':'PT1;DROP'},{'patient_id':'PT1','estimated_cost':0}])
def test_strict_patient_arguments(payload):
    with pytest.raises(ValidationError): PatientArguments.model_validate_json(json.dumps(payload))

def test_strict_intervention_arguments():
    with pytest.raises(ValidationError):
        InterventionArguments.model_validate_json('{"patient_id":"PT1","intervention":"FREE_MONEY"}')
    with pytest.raises(ValidationError):
        InterventionArguments.model_validate_json('{"patient_id":"PT1","intervention":"DISCOUNT","requires_approval":false}')

def test_unknown_patient_fails_before_appointment_aggregate():
    class SQL:
        def table(self,name): return name
        def query(self,query,parameters=None):
            assert 'patients' in query
            return []
    with pytest.raises(KeyError): DataTools(SQL()).get_appointment_behavior('PT999')

def test_typed_sql_results_exclude_generator_fields():
    result=FixtureTools().calculate_revenue_at_risk('PT1')
    assert type(result['prior_visits']) is int
    assert type(result['mean_revenue']) is float
    assert result['revenue_at_risk']==397.75
    class SQL:
        def table(self,name): return name
        def query(self,query,parameters=None):
            return [{'patient_id':'PT1','tenure_months':'6','churn_risk_score':'1','status':'Churned','email':'invented'}]
    patient=DataTools(SQL()).require_patient('PT1')
    assert patient['tenure_months']==6
    assert not {'churn_risk_score','status','email'} & patient.keys()

def test_intervention_economics_and_approval_thresholds():
    s=simulate_economics('SCHEDULING_ASSISTANCE',397.75,1)
    assert (s['expected_recovery'],s['estimated_cost'],s['net_value'])==(178.99,8,170.99)
    assert s['incremental_net_value']==131.21
    assert s['requires_approval'] is False
    d=simulate_economics('DISCOUNT',397.75,1)
    assert (d['expected_recovery'],d['estimated_cost'],d['net_value'])==(198.88,34.83,164.05)
    assert d['requires_approval'] is True
    assert simulate_economics('STAFF_OUTREACH',4000,1)['requires_approval'] is True
    assert simulate_economics('ALTERNATE_PROVIDER',100,1)['requires_approval'] is True

def test_real_loop_shape_and_dynamic_tools(tmp_path):
    service=make_service(tmp_path,FixtureModel())
    result=service.run('PT1')
    Case.model_validate(result)
    assert result['orchestration_mode']=='llm'
    assert result['agent_run']['model_calls']==2
    assert result['agent_run']['snapshot_model_calls']==0
    assert result['agent_run']['inference_http_attempts']==2
    assert result['agent_run']['tool_calls_count']==2
    assert [e['stage'] for e in result['trace']]==['OBSERVE','INVESTIGATE','INVESTIGATE','INVESTIGATE','DIAGNOSE','SIMULATE','DECIDE','ACT','MEASURE']
    assert result['action']['status']=='EXECUTED'
    assert result['action']['requires_approval'] is False
    assert result['outcome']['revenue_recovered']==0
    assert 'PRIVATE_FIXTURE_REASONING' not in json.dumps(result)
    assert 'name' not in result['patient']
    assert service.ledger.get('PT1')['action']==result['action']
    assert service.run('PT1')['action']==result['action']
    other=make_service(tmp_path/'other',FixtureModel(extra_history=True)).run('PT1')
    assert other['agent_run']['tool_calls'][0]['tool']=='get_additional_visit_history'
    assert other['agent_run']['model_calls']==3
    assert other['agent_run']['optional_investigation_calls']==1

def test_discount_cannot_execute_without_approval(tmp_path):
    service=make_service(tmp_path,FixtureModel('DISCOUNT'))
    result=service.run('PT1')
    assert result['status']=='AWAITING_APPROVAL'
    assert result['action']['status']=='PENDING_APPROVAL'
    assert result['action']['requires_approval'] is True
    assert result['outcome'] is None
    assert 'MEASURE' not in [e['stage'] for e in result['trace']]
    approved=service.approval(result['action']['action_id'],by_action=True)
    assert approved['action']['approval_status']=='APPROVED'
    assert approved['action']['status']=='EXECUTED'
    assert approved['outcome']['observed_revenue_recovered']==0

def test_evidence_and_action_guards(tmp_path):
    service=make_service(tmp_path,FixtureModel())
    session=AgentToolSession('PT1',service.tools,service,{'patient_id':'PT1'})
    with pytest.raises(ToolPolicyError):
        session.execute('get_patient_history','{"patient_id":"PT2"}','other')
    with pytest.raises(ToolPolicyError):
        session.execute('create_outreach_task','{"patient_id":"PT1","intervention":"DISCOUNT"}','premature')
    session.execute('calculate_revenue_at_risk','{"patient_id":"PT1"}','risk')
    args={'patient_id':'PT1','phase':'DIAGNOSE','diagnosis':'GENERAL_DISENGAGEMENT','confidence':.5,'intervention':None,
          'rationale':'Observed behavioral gap warrants review.','evidence_ids':['E999','E4']}
    with pytest.raises(ToolPolicyError): session.execute('record_agent_decision',json.dumps(args),'fake-evidence')
    args['evidence_ids']=[key for key,e in session.evidence.items() if e['field'] in ('gap_days','prior_visits')]
    args['diagnosis']='VALUE_CONCERN'
    with pytest.raises(ToolPolicyError): session.execute('record_agent_decision',json.dumps(args),'fake-cause')
    args['diagnosis']='REPEATED_MISSED_APPOINTMENTS'
    with pytest.raises(ToolPolicyError): session.execute('record_agent_decision',json.dumps(args),'not-repeated')

def test_iteration_limit_and_honest_failure(tmp_path):
    class NoToolsModel:
        def complete(self,*args): return {'content':'I sent a message and recovered $999.'}
    service=make_service(tmp_path,NoToolsModel())
    with pytest.raises(AgentFailure,match='registered structured'): service.run('PT1')
    assert service.ledger.all()==[]
    client=TestClient(create_app(Settings(),service))
    assert client.post('/api/agent/run',json={'patient_id':'PT1'}).status_code==502
    assert client.post('/api/agent/run',json={'patient_id':'PT999'}).status_code==404

def test_reasoning_content_filter():
    assert public_text([{'type':'reasoning','text':'PRIVATE'},{'type':'text','text':'{"ok":true}'}])=='{"ok":true}'
    assert public_text(None)==''
    assert len(native_tools())==8
    schemas=json.dumps(native_tools())
    assert '$ref' not in schemas
    assert '$defs' not in schemas
    decision=next(t for t in native_tools() if t['function']['name']=='record_agent_decision')
    assert 'VISIT_FREQUENCY_DECLINE' in decision['function']['parameters']['properties']['diagnosis']['enum']
    assert decision['function']['parameters']['properties']['evidence_ids']['items']['type']=='string'

def test_tools_follow_guards_and_remaining_budget(tmp_path):
    service=make_service(tmp_path,FixtureModel())
    session=AgentToolSession('PT1',service.tools,service,{'patient_id':'PT1'})
    names=lambda budget:{t['function']['name'] for t in available_tools(session,budget)}
    assert 'simulate_intervention' not in names(10)
    assert 'create_outreach_task' not in names(10)
    assert 'get_patient_history' in names(10)
    assert 'get_patient_history' not in names(6)
    session.execute('calculate_revenue_at_risk','{"patient_id":"PT1"}','risk')
    assert 'record_agent_decision' in names(6)
    assert 'compare_patient_patterns' not in names(5)
    args={'patient_id':'PT1','phase':'DIAGNOSE','diagnosis':'VISIT_FREQUENCY_DECLINE','confidence':.7,'intervention':None,
          'rationale':'Observed four prior visits and zero recent visits.',
          'evidence_ids':[key for key,e in session.evidence.items() if e['field'] in ('prior_visits','recent_visits')]}
    session.execute('record_agent_decision',json.dumps(args),'diagnosis')
    assert 'simulate_intervention' in names(5)
    assert 'record_agent_decision' not in names(5)
    session.execute('simulate_intervention','{"patient_id":"PT1","intervention":"NO_ACTION"}','baseline')
    session.execute('simulate_intervention','{"patient_id":"PT1","intervention":"SCHEDULING_ASSISTANCE"}','simulation')
    args.update(phase='DECIDE',intervention='SCHEDULING_ASSISTANCE')
    session.execute('record_agent_decision',json.dumps(args),'decision')
    assert names(2)=={'create_outreach_task'}
    session.execute('create_outreach_task','{"patient_id":"PT1","intervention":"SCHEDULING_ASSISTANCE"}','action')
    assert names(1)==set()
