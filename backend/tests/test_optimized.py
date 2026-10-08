import copy
import json
import threading
from datetime import datetime,timezone,timedelta
from types import SimpleNamespace
from unittest.mock import Mock
import httpx
import pytest
from fastapi.testclient import TestClient
from chiro_backend.agent import (ModelHTTPError,AgentFailure,DatabricksModel,retry_delay,serving_tools)
from chiro_backend.agent_tools import ToolPolicyError
from chiro_backend.app import create_app
from chiro_backend.config import Settings
from chiro_backend.delta import DeltaLedger
from chiro_backend.runtime import ModelPacer,request_deadline,DeadlineExceeded
from chiro_backend.service import RetentionService,Conflict
from chiro_backend.tool_models import DiagnosisPlan,Intervention
from test_agent import FixtureModel,FixtureTools,make_service

class Clock:
    def __init__(self): self.t=100.; self.sleeps=[]
    def now(self): return self.t
    def sleep(self,value): self.sleeps.append(value); self.t+=value

def clock_service(tmp_path,model,monkeypatch):
    clock=Clock()
    monkeypatch.setattr('chiro_backend.runtime.time.monotonic',clock.now)
    service=make_service(tmp_path,model)
    service.agent.pacer=ModelPacer(interval=5,clock=clock.now,sleep=clock.sleep)
    service.agent.jitter=lambda:0
    return service,clock

@pytest.mark.parametrize('intervention',['STAFF_OUTREACH','SCHEDULING_ASSISTANCE','DISCOUNT','NO_ACTION'])
def test_model_selects_not_python_maximum(tmp_path,intervention):
    service=make_service(tmp_path,FixtureModel(intervention))
    case=service.run('PT1')
    assert case['agent_run']['successful_gpt_responses']==2
    assert case['action']['type']==intervention
    if intervention=='NO_ACTION':
        assert max(case['interventions'],key=lambda r:r['net_value'])['intervention_id']=='STAFF_OUTREACH'
    assert [r['tool'] for r in case['agent_run']['tool_calls']]==['diagnose_and_simulate','select_intervention']
    assert {t['stage'] for t in case['trace']}>= {'OBSERVE','INVESTIGATE','DIAGNOSE','SIMULATE','DECIDE','ACT'}
    assert 'PRIVATE_FIXTURE_REASONING' not in json.dumps(case)

@pytest.mark.parametrize('requested',['DISCOUNT','ALTERNATE_LOCATION','FREE_MONEY'])
def test_batch_rejects_inactive_unknown_or_unsupported_option(tmp_path,requested):
    service=make_service(tmp_path,FixtureModel())
    session,_=service.agent.prepare('PT1')
    session.cache['_catalog']={'NO_ACTION':{'estimated_cost':0,'requires_approval':False}}
    service.ledger.interventions=lambda:session.cache['_catalog']
    if requested=='FREE_MONEY':
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            DiagnosisPlan.model_validate_json(json.dumps({'patient_id':'PT1','diagnosis':'GENERAL_DISENGAGEMENT','confidence':.5,
                'evidence_ids':['E1','E2'],'rationale':'Observed operational evidence warrants review.','interventions':[requested]}))
    else:
        with pytest.raises(ToolPolicyError): service.agent.batch(session,[Intervention(requested)])
    assert session.simulations=={}
    assert service.ledger.all()==[]

def test_batch_one_calculation_context_and_serving_schema(tmp_path):
    service=make_service(tmp_path,FixtureModel())
    session,snapshot=service.agent.prepare('PT1')
    results=service.agent.batch(session,[Intervention.STAFF_OUTREACH,Intervention.SCHEDULING_ASSISTANCE])
    assert {r['intervention_id'] for r in results}=={'NO_ACTION','STAFF_OUTREACH','SCHEDULING_ASSISTANCE'}
    assert len({r['simulation_id'] for r in results})==3
    assert next(r for r in results if r['intervention_id']=='SCHEDULING_ASSISTANCE')['net_value']==170.99
    def inspect(node):
        if isinstance(node,dict):
            assert not set(node)&{'pattern','anyOf','oneOf','allOf','$ref','$defs'}
            for v in node.values(): inspect(v)
        elif isinstance(node,list):
            for v in node: inspect(v)
    inspect(serving_tools(session,0))
    assert snapshot['snapshot_model_calls']==0
    assert not {'name','email','phone','status','churn_risk_score'}&snapshot['patient'].keys()

@pytest.mark.parametrize('header,body,expected',[
    ('3',{'error':{'retry_after':8}},8),
    ('12',{'retry_after':2},12),
    ('garbage',{'retry_after':4},4),
    ('-1',{'retry_after':'NaN'},None),
    (None,{},None)])
def test_retry_after_longest_valid(header,body,expected):
    assert retry_delay({'Retry-After':header},body)==expected

def test_retry_after_http_date():
    now=datetime(2026,10,8,12,tzinfo=timezone.utc)
    value=(now+timedelta(seconds=10)).strftime('%a, %d %b %Y %H:%M:%S GMT')
    assert retry_delay({'Retry-After':value},{'retry_after':3},now)==10

class RetryModel(FixtureModel):
    def __init__(self,failures): super().__init__(); self.failures=list(failures); self.attempts=[]
    def complete(self,messages,tools,timeout):
        self.attempts.append(copy.deepcopy(messages))
        if self.failures and self.failures[0][0]==len(self.attempts):
            _,delay=self.failures.pop(0)
            raise ModelHTTPError(429,{'message':'workspace QPS exceeded','retry_after':delay,'headers':{}})
        return super().complete(messages,tools,timeout)

@pytest.mark.parametrize('server_delay,expected_wait',[(8,8),(None,5)])
def test_429_same_step_without_tools_or_action_replay(tmp_path,monkeypatch,server_delay,expected_wait):
    model=RetryModel([(1,server_delay),(3,None)])
    service,clock=clock_service(tmp_path,model,monkeypatch)
    history_calls=[]
    original=service.tools.get_patient_history
    service.tools.get_patient_history=lambda pid:(history_calls.append(pid) or original(pid))
    saves=[]
    save=service.ledger.save
    service.ledger.save=lambda c:(saves.append(copy.deepcopy(c)) or save(c))
    case=service.run('PT1')
    assert case['agent_run']['successful_gpt_responses']==2
    assert case['agent_run']['inference_http_attempts']==4
    assert case['agent_run']['http_429_count']==case['agent_run']['retry_count']==2
    assert model.attempts[0]==model.attempts[1] and model.attempts[2]==model.attempts[3]
    assert history_calls==['PT1']
    assert len([t for t in case['trace'] if t['stage']=='SIMULATE'])==1
    assert len([t for t in case['trace'] if t['stage']=='ACT'])==1
    assert len(saves)==2
    assert clock.sleeps[0]==expected_wait
    assert len(service.ledger.all())==1

def test_retry_exhaustion_global_bound(tmp_path,monkeypatch):
    model=RetryModel([(1,None),(2,None),(3,None)])
    service,clock=clock_service(tmp_path,model,monkeypatch)
    with pytest.raises(AgentFailure,match='retry budget exhausted'): service.run('PT1')
    assert service.agent.last_run['inference_http_attempts']==3
    assert service.agent.last_run['retry_count']==2
    assert clock.sleeps==[5,10]
    assert service.ledger.all()==[]

def test_pacing_request_start_times_and_long_inference():
    clock=Clock(); pacer=ModelPacer(5,clock.now,clock.sleep)
    pacer.admit(75)
    clock.t+=2
    pacer.admit(73)
    assert clock.sleeps==[3]
    clock.t+=7
    pacer.admit(66)
    assert clock.sleeps==[3]

def test_whole_deadline_includes_initial_reads(tmp_path,monkeypatch):
    service,clock=clock_service(tmp_path,FixtureModel(),monkeypatch)
    original=service.ledger.get
    service.ledger.get=lambda pid:(setattr(clock,'t',clock.t+76) or original(pid))
    with pytest.raises(DeadlineExceeded): service.run('PT1')
    assert service.agent.model.turn==0
    assert service.ledger.all()==[]

def test_retry_delay_never_shortened_to_deadline(tmp_path,monkeypatch):
    service,clock=clock_service(tmp_path,RetryModel([(1,100)]),monkeypatch)
    with pytest.raises(DeadlineExceeded): service.run('PT1')
    assert clock.sleeps==[] and service.ledger.all()==[]

def test_one_active_run_per_process(tmp_path):
    entered=threading.Event(); release=threading.Event(); result=[]
    class BlockingModel(FixtureModel):
        def complete(self,*args):
            if self.turn==0:
                entered.set(); assert release.wait(5)
            return super().complete(*args)
    first=make_service(tmp_path/'first',BlockingModel())
    second=make_service(tmp_path/'second',FixtureModel())
    worker=threading.Thread(target=lambda:result.append(first.run('PT1')))
    worker.start(); assert entered.wait(5)
    try:
        with pytest.raises(Conflict,match='Another agent run'): second.run('PT1')
        assert second.agent.model.turn==0
    finally:
        release.set(); worker.join(5)
    assert len(result)==1

def test_duplicate_request_no_inference_or_writes(tmp_path):
    service=make_service(tmp_path,FixtureModel())
    case=service.run('PT1')
    service.ledger.save=Mock(side_effect=AssertionError('Duplicate request must not write'))
    assert service.run('PT1')==case
    assert service.agent.model.turn==2

@pytest.mark.parametrize('fail_at',[1,2])
def test_partial_persistence_recovers_without_reinference(tmp_path,fail_at):
    service=make_service(tmp_path,FixtureModel())
    save=service.ledger.save
    calls=0
    def flaky(case):
        nonlocal calls
        calls+=1
        if calls==fail_at:
            # First failure before commit, final failure after commit both recover.
            if fail_at==2: save(case)
            from chiro_backend.databricks import DataUnavailable
            raise DataUnavailable('Injected persistence interruption')
        save(case)
    service.ledger.save=flaky
    with pytest.raises(Exception,match='persistence interruption'): service.run('PT1')
    assert service.agent.model.turn==2
    case=service.run('PT1')
    assert service.agent.model.turn==2
    assert case['agent_run']['status']=='COMPLETED'
    assert len([t for t in case['trace'] if t['stage']=='ACT'])==1
    assert len([t for t in case['trace'] if t['stage']=='MEASURE'])==1
    assert len(service.ledger.all())==1

def test_partial_delta_outcome_commit_resume_from_new_service(tmp_path):
    # Small SQL-backed ledger emulator: MERGE identities and interrupted commits.
    class SQL:
        def __init__(self): self.actions={}; self.outcomes={}; self.fail=True
        def table(self,n): return n
        def query(self,q,p=None):
            if q.startswith('SELECT case_json'):
                return [{'case_json':row['case_json']} for row in self.actions.values() if row['patient_id']==p['patient_id']]
            if 'MERGE INTO simulated_outcomes' in q:
                self.outcomes.setdefault(p['outcome_id'],copy.deepcopy(p)); return []
            if 'MERGE INTO agent_actions' in q:
                if self.fail and self.outcomes:
                    self.fail=False
                    from chiro_backend.databricks import DataUnavailable
                    raise DataUnavailable('Final action payload unavailable')
                self.actions[p['action_id']]=copy.deepcopy(p); return []
            if 'SELECT intervention_type' in q:
                return [{'intervention_type':k,'estimated_cost':v,'requires_approval':'false'} for k,v in [('NO_ACTION','0'),('SCHEDULING_ASSISTANCE','8')]]
            raise AssertionError(q)
    sql=SQL(); service=make_service(tmp_path,FixtureModel()); service.ledger=DeltaLedger(sql)
    with pytest.raises(Exception,match='Final action payload'): service.run('PT1')
    assert len(sql.actions)==len(sql.outcomes)==1
    other=make_service(tmp_path/'restart',FixtureModel()); other.ledger=DeltaLedger(sql)
    case=other.run('PT1')
    assert other.agent.model.turn==0
    assert case['agent_run']['status']=='COMPLETED'
    assert len(sql.actions)==len(sql.outcomes)==1

def test_model_transport_preserves_safe_429_metadata(monkeypatch):
    captured=[]
    def transport(request):
        captured.append(request)
        return httpx.Response(429,headers={'Retry-After':'9','X-Request-ID':'req1','Set-Cookie':'SECRET'},
            json={'error':{'message':'Quota exceeded','retry_after':12,'limit_type':'QPS','limit':1,'current':2}})
    original=httpx.Client
    monkeypatch.setattr('chiro_backend.agent.httpx.Client',lambda **kw:original(transport=httpx.MockTransport(transport),**kw))
    sql=SimpleNamespace(client=SimpleNamespace(config=SimpleNamespace(host='https://example.invalid',authenticate=lambda:{'Authorization':'SECRET'})))
    with pytest.raises(ModelHTTPError) as error: DatabricksModel(sql,'model').complete([],[],20)
    assert error.value.metadata['retry_after']==12
    assert error.value.metadata['headers']['x-request-id']=='req1'
    assert 'SECRET' not in json.dumps(error.value.metadata)
    assert len(captured)==1

def test_two_optional_investigations_then_two_decisions(tmp_path):
    class InvestigatingModel(FixtureModel):
        def __init__(self): super().__init__(); self.optional_turns=0
        def complete(self,messages,tools,timeout):
            if self.optional_turns<2:
                name=['get_additional_visit_history','compare_patient_patterns'][self.optional_turns]
                self.optional_turns+=1
                return {'tool_calls':[{'id':f'optional-{self.optional_turns}','type':'function','function':{
                    'name':name,'arguments':'{"patient_id":"PT1"}'}}]}
            assert not {'get_additional_visit_history','compare_patient_patterns'} & {t['function']['name'] for t in tools}
            return super().complete(messages,tools,timeout)
    service=make_service(tmp_path,InvestigatingModel())
    from chiro_backend.agent_tools import AgentToolSession
    original=AgentToolSession.patterns
    AgentToolSession.patterns=lambda s:{'patient_id':'PT1','location_change_observed':False,'provider_change_observed':False}
    try: case=service.run('PT1')
    finally: AgentToolSession.patterns=original
    assert case['agent_run']['successful_gpt_responses']==4
    assert case['agent_run']['optional_investigation_calls']==2

def test_insufficient_evidence_no_action_is_valid(tmp_path):
    class InsufficientModel(FixtureModel):
        def complete(self,*args):
            result=super().complete(*args)
            function=result['tool_calls'][0]['function']
            values=json.loads(function['arguments'])
            if function['name']=='diagnose_and_simulate':
                values['diagnosis']='INSUFFICIENT_EVIDENCE'
                values['interventions']=['NO_ACTION']
            else:
                values['intervention']='NO_ACTION'
            function['arguments']=json.dumps(values)
            return result
    case=make_service(tmp_path,InsufficientModel()).run('PT1')
    assert case['diagnosis']['category']=='INSUFFICIENT_EVIDENCE'
    assert case['action']['type']=='NO_ACTION'
    assert len(case['interventions'])==1
    assert case['agent_run']['successful_gpt_responses']==2

def test_deadline_covers_persistence_and_resumes(tmp_path,monkeypatch):
    service,clock=clock_service(tmp_path,FixtureModel(),monkeypatch)
    original=service.ledger.save
    first=True
    def slow(case):
        nonlocal first
        original(case)
        if first:
            first=False
            clock.t+=76
    service.ledger.save=slow
    with pytest.raises(DeadlineExceeded): service.run('PT1')
    assert service.agent.model.turn==2
    resumed=service.run('PT1')
    assert resumed['agent_run']['status']=='COMPLETED'
    assert resumed['outcome']['value_type']=='SIMULATED'
    assert service.agent.model.turn==2

def test_sql_client_uses_installed_sdk_config_contract(monkeypatch):
    from chiro_backend.databricks import DatabricksSQL
    from databricks.sdk.core import Config
    monkeypatch.setattr('chiro_backend.databricks.Config',lambda **kw:SimpleNamespace(**kw))
    # WorkspaceClient's installed signature accepts Config, not timeout keywords.
    class Client:
        def __init__(self,*,config): self.config=config
    monkeypatch.setattr('chiro_backend.databricks.WorkspaceClient',Client)
    sql=DatabricksSQL(Settings())
    with request_deadline(75):
        assert sql.client.config.profile=='DEFAULT'
        assert sql.client.config.http_timeout_seconds<=10
        assert sql.client.config.retry_timeout_seconds==1

def test_sql_polling_respects_remaining_whole_deadline(monkeypatch):
    from chiro_backend.databricks import DatabricksSQL
    clock=Clock()
    monkeypatch.setattr('chiro_backend.runtime.time.monotonic',clock.now)
    monkeypatch.setattr('chiro_backend.databricks.time.sleep',clock.sleep)
    sql=DatabricksSQL(Settings())
    calls=[]
    def pending(method,path,body=None):
        calls.append((method,path,body))
        return {'statement_id':'s1','status':{'state':'RUNNING'}}
    monkeypatch.setattr(sql,'request',pending)
    with pytest.raises(DeadlineExceeded):
        with request_deadline(.3): sql.query('SELECT 1')
    assert clock.t<=100.3
    assert calls[0][2]['wait_timeout']=='0s'

@pytest.mark.parametrize('citation,allowed', [('selected', True), ('unknown_simulation', False), ('unknown_evidence', False)])
def test_final_citations_registry_and_implicit_baseline(tmp_path, citation, allowed):
    class CitationModel(FixtureModel):
        def complete(self, messages, tools, timeout):
            response = super().complete(messages, tools, timeout)
            function = response['tool_calls'][0]['function']
            if function['name'] == 'select_intervention':
                arguments = json.loads(function['arguments'])
                simulations = next(json.loads(m['content'])['simulations'] for m in messages if m['role']=='tool' and 'simulations' in json.loads(m['content']))
                arguments['simulation_ids'] = [next(s['simulation_id'] for s in simulations if s['intervention_id']==self.intervention)]
                if citation == 'unknown_simulation': arguments['simulation_ids'].append('S999')
                if citation == 'unknown_evidence': arguments['evidence_ids'][0] = 'E999'
                function['arguments'] = json.dumps(arguments)
            return response
    service = make_service(tmp_path, CitationModel())
    if allowed:
        case = service.run('PT1')
        assert case['agent_run']['successful_gpt_responses'] == 2
        assert {s['intervention_id'] for s in case['decision']['simulation_evidence']} == {'SCHEDULING_ASSISTANCE', 'NO_ACTION'}
    else:
        with pytest.raises(AgentFailure): service.run('PT1')
        assert service.ledger.all() == []
        assert service.agent.last_run['last_model_function']['name'] == 'select_intervention'
        assert 'ToolPolicyError:' in service.agent.last_run['error']
