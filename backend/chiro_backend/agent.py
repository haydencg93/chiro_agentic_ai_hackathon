"""Two native reasoning decisions, optional investigation, and guarded Python ACT."""
import copy
import json
import math
import time
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone
import httpx
from pydantic import ValidationError
from .agent_tools import AgentToolSession, ToolPolicyError, CATALOG, simulate_economics
from .tool_models import (PatientArguments, DiagnosisPlan, SelectionArguments, DecisionArguments,
                          InterventionArguments, Intervention, Diagnosis, Snapshot)
from .databricks import DataUnavailable
from .runtime import remaining, request_deadline, MODEL_PACER, DeadlineExceeded

class AgentFailure(RuntimeError):
    pass

class ModelHTTPError(AgentFailure):
    def __init__(self,status,metadata):
        self.status,self.metadata=status,metadata
        super().__init__(f'Model inference HTTP {status}: {metadata.get("message","request failed")}; no fallback reasoning substituted')

def public_text(content):
    if isinstance(content,str): return content
    if isinstance(content,list):
        return ''.join(b.get('text','') for b in content if isinstance(b,dict) and b.get('type')=='text')
    return ''

def retry_delay(headers,body,now=None):
    """Longest valid server delay, including delta seconds or HTTP-date."""
    values=[]
    value=headers.get('retry-after') or headers.get('Retry-After')
    if value:
        try:
            values.append(float(value))
        except (TypeError,ValueError):
            try:
                stamp=parsedate_to_datetime(value)
                if stamp.tzinfo is None: stamp=stamp.replace(tzinfo=timezone.utc)
                values.append((stamp-(now or datetime.now(timezone.utc))).total_seconds())
            except (TypeError,ValueError,OverflowError): pass
    def collect(node):
        if isinstance(node,dict):
            for key,item in node.items():
                if key=='retry_after':
                    try: values.append(float(item))
                    except (TypeError,ValueError): pass
                elif isinstance(item,(dict,list)): collect(item)
        elif isinstance(node,list):
            for item in node: collect(item)
    collect(body)
    valid=[v for v in values if math.isfinite(v) and v>=0]
    return max(valid) if valid else None

class DatabricksModel:
    def __init__(self,sql,endpoint):
        self.sql,self.endpoint=sql,endpoint
    def complete(self,messages,tools,timeout):
        workspace=self.sql.client
        body={'messages':messages,'max_tokens':2048,'tools':tools,'tool_choice':'required'}
        # No SDK inference retries; retry admission belongs to the run below.
        budget=min(timeout,remaining())
        with httpx.Client(timeout=min(15,budget/4)) as client:
            response=client.post(f'{workspace.config.host.rstrip("/")}/serving-endpoints/{self.endpoint}/invocations',
                headers=workspace.config.authenticate(),json=body)
        remaining()
        payload=response.json()
        if response.status_code!=200:
            error=payload.get('error',{})
            if not isinstance(error,dict): error={}
            message=str(payload.get('message') or error.get('message') or 'Request failed')[:1000]
            # Only explicitly allowlisted metadata; no raw headers, prompts, or reasoning.
            metadata={'message':message,'http_status':response.status_code,
                'headers':{k:v[:300] for k,v in response.headers.items() if k.lower() in
                    ('retry-after','x-request-id','x-databricks-request-id','x-ratelimit-limit','x-ratelimit-remaining','x-ratelimit-reset')},
                'error_code':str(payload.get('error_code') or error.get('code') or '')[:100],
                'retry_after':retry_delay(response.headers,payload)}
            for key in ('limit_type','limit','current'):
                value=error.get(key,payload.get(key))
                if isinstance(value,(str,int,float)): metadata[key]=value
            raise ModelHTTPError(response.status_code,metadata)
        return payload['choices'][0]['message']

SYSTEM='''You are a business/operational retention agent for synthetic chiropractic data.
Python has already retrieved a verified patient snapshot, evidence IDs, and active intervention catalog.
Normally use TWO responses: (1) diagnose_and_simulate, (2) select_intervention after seeing economics.
You decide the diagnosis, whether evidence is sufficient, which interventions to compare, and the final
choice. Do not automatically request extra tools. If necessary, request registered optional investigation;
at most two such requests are allowed. Call ONLY function names advertised in this request.
Cite at least two exact evidence_ids supplied by Python. Do not invent IDs, names, contact details,
DOBs, medical diagnoses, provider names, payer information or other unavailable facts.
Diagnosis is an OPERATIONAL HYPOTHESIS, never a confirmed cause or clinical diagnosis/advice.
Generator churn scores/status are not ground truth. Future bookings are not a signal.
One missed appointment cannot mean repeated misses. Location/provider friction and alternate options
require observed changes from compare_patient_patterns, and changes do not prove friction.
No affordability evidence exists; VALUE_CONCERN cannot be supported. INSUFFICIENT_EVIDENCE and
NO_ACTION are valid. If evidence is insufficient, prefer NO_ACTION. All recovery effects are unvalidated
SIMULATED assumptions; revenue at risk is ESTIMATED. Never claim observed recovered revenue.
In diagnose_and_simulate, select the active intervention types you want compared. Python includes the
NO_ACTION baseline and computes ALL money, costs, recovery, net values and approval flags together.
Then select_intervention chooses a simulated option and cites simulation_ids plus source evidence_ids.
Selection is yours; Python does not select the highest net automatically. Explain relevant tradeoffs in a
short audit summary. Do not calculate money yourself. After validated selection Python handles ACT,
manager approval and simulated MEASURE; do not call action/catalog/history/risk tools mechanically.
Financial/high-impact actions cannot bypass approval. No external contact or clinical treatment occurs.
Return concise structured function arguments, never private chain-of-thought.
'''

def serving_tools(session,investigation_count):
    """Flat serving schemas; strict constraints are applied separately by Pydantic."""
    string={'type':'string'}
    evidence={'type':'array','items':{'type':'string','enum':list(session.evidence)}}
    def function(name,description,properties):
        return {'type':'function','function':{'name':name,'description':description,'parameters':{
            'type':'object','properties':properties,'required':list(properties),'additionalProperties':False}}}
    if session.diagnosis is None:
        definitions=[function('diagnose_and_simulate','State your operational hypothesis, cite source evidence IDs, and choose active interventions for one Python batch calculation.',
            {'patient_id':string,'diagnosis':{'type':'string','enum':[d.value for d in Diagnosis]},
             'confidence':{'type':'number'},'evidence_ids':evidence,'rationale':string,
             'interventions':{'type':'array','items':{'type':'string','enum':list(session.catalog())}}})]
    else:
        definitions=[function('select_intervention','Select one computed intervention after comparing SIMULATED economics. Cite source evidence IDs and exact simulation IDs. Python executes approvals/action/measurement.',
            {'patient_id':string,'intervention':{'type':'string','enum':list(session.simulations)},
             'evidence_ids':evidence,'simulation_ids':{'type':'array','items':{'type':'string','enum':[r['simulation_id'] for r in session.simulations.values()]}},'rationale':string})]
    if investigation_count<2:
        completed={r['tool'] for r in session.results.values()}
        for name,description in [('compare_patient_patterns','Investigate recent/prior observed provider/location changes only when relevant; changes do not prove friction.'),
                                 ('get_additional_visit_history','Read the full bounded visit history beyond the initial five rows if those rows are insufficient.')]:
            if name not in completed:
                definitions.append(function(name,description,{'patient_id':string}))
    return definitions

def safe_visits(visits):
    fields=('visit_id','visit_date','provider_id','location_id','revenue')
    return [{k:v[k] for k in fields if k in v} for v in visits]

def register_evidence(session,tool,result,call_id):
    session.results[call_id]={'tool':tool,'result':result}
    for field,value in result.items():
        if isinstance(value,(int,float,bool)) or field=='as_of_date':
            eid=f'E{len(session.evidence)+1}'
            session.evidence[eid]={'evidence_id':eid,'tool_call_id':call_id,'tool':tool,'field':field,'value':value}

class RevenueRescueAgent:
    deadline_seconds=75
    max_iterations=4
    def __init__(self,tools,service,model,endpoint='databricks-gpt-oss-120b',pacer=None,jitter=None):
        self.tools,self.service,self.model,self.endpoint=tools,service,model,endpoint
        self.pacer=pacer or MODEL_PACER
        import random
        self.jitter=jitter or random.random
        self.last_run=None
    def inference(self,messages,definitions,run):
        # A frozen step payload is reused exactly on 429. No tools run in this method.
        frozen_messages,frozen_tools=copy.deepcopy(messages),copy.deepcopy(definitions)
        while True:
            self.pacer.admit(remaining())
            remaining()
            run['inference_http_attempts']+=1
            try:
                message=self.model.complete(copy.deepcopy(frozen_messages),copy.deepcopy(frozen_tools),remaining())
                remaining()
                run['successful_gpt_responses']+=1
                run['model_calls']=run['successful_gpt_responses']
                return message
            except ModelHTTPError as exc:
                run['response_metadata'].append(exc.metadata)
                if exc.status!=429: raise
                run['http_429_count']+=1
                if run['retry_count']>=2:
                    raise AgentFailure('GPT-OSS 429 retry budget exhausted; no reasoning or action fabricated') from exc
                delay=exc.metadata.get('retry_after')
                if delay is None: delay=5*(2**run['retry_count'])+self.jitter()
                if delay>=remaining():
                    raise DeadlineExceeded('Server retry delay exceeds whole-request deadline') from exc
                run['retry_count']+=1
                self.pacer.cooldown(delay)
    def prepare(self,pid):
        if hasattr(self.tools,'initial_evidence'):
            history,behavior,risk=self.tools.initial_evidence(pid)
        else: # Explicit unit/local tool adapters.
            history=self.tools.get_patient_history(pid)
            risk=self.tools.calculate_revenue_at_risk(pid)
            behavior=self.tools.get_appointment_behavior(pid)
        session=AgentToolSession(pid,self.tools,self.service,history['patient'])
        session.cache.update(get_patient_history=history,get_appointment_behavior=behavior,calculate_revenue_at_risk=risk)
        for name,result in [('get_patient_history',{'visits_returned':history.get('visits_returned',len(history['visits'])),'history_limit':100}),
                            ('get_appointment_behavior',behavior),('calculate_revenue_at_risk',risk)]:
            register_evidence(session,name,result,'snapshot:'+name)
            session.trace_event('INVESTIGATE','Initial evidence retrieved',
                f'Python snapshot: {name}; no GPT request.',name,'snapshot:'+name)
        catalog=session.catalog()
        snapshot=Snapshot(patient=history['patient'],visit_history=safe_visits(history['visits'][:5]),history_limit=5,
            appointment_behavior=behavior,revenue_risk=risk,snapshot_date=risk['as_of_date'],evidence=list(session.evidence.values()),
            interventions=[dict(intervention=k,name=CATALOG[Intervention(k)][0],**v) for k,v in catalog.items()],
            limitations=self.service.build_case(risk)['limitations']).model_dump(mode='json')
        return session,snapshot
    def batch(self,session,interventions):
        keys=[item.value for item in interventions]
        if len(keys)!=len(set(keys)):
            raise ToolPolicyError('Duplicate intervention in batch')
        if 'NO_ACTION' not in keys: keys.append('NO_ACTION')
        catalog=session.catalog()
        for key in keys:
            if key not in catalog: raise ToolPolicyError('Intervention is not active in Delta catalog')
            for option,field in [('ALTERNATE_LOCATION','location_change_observed'),('ALTERNATE_PROVIDER','provider_change_observed')]:
                if key==option and not session.cache.get('compare_patient_patterns',{}).get(field):
                    raise ToolPolicyError('Alternate provider/location requires observed changes from optional investigation')
        # Validation completes before any calculation/state changes.
        result=[]
        for key in keys:
            remaining()
            economics=simulate_economics(key,session.risk()['revenue_at_risk'],session.risk()['missed'],catalog[key])
            economics['simulation_id']=f'S{len(result)+1}'
            result.append(economics)
        session.simulations={r['intervention_id']:r for r in result}
        session.trace_event('SIMULATE','Python batch simulation',
            'SIMULATED '+ '; '.join(f"{r['intervention_id']}: recovery ${r['expected_recovery']}, cost ${r['estimated_cost']}, net ${r['net_value']}" for r in result),
            'simulate_interventions',evidence=[{'simulation_id':r['simulation_id'],'intervention':r['intervention_id'],'value_type':'SIMULATED'} for r in result])
        return result
    def run(self,patient_id):
        with request_deadline(self.deadline_seconds):
            return self._run(patient_id)
    def _run(self,pid):
        start=time.monotonic()
        run={'architecture':'snapshot_two_decisions','status':'RUNNING','model':self.endpoint,'model_calls':0,
            'successful_gpt_responses':0,'inference_http_attempts':0,'http_429_count':0,'retry_count':0,
            'optional_investigation_calls':0,'snapshot_model_calls':0,'tool_calls':[], 'response_metadata':[],
            'max_optional_investigations':2,'deadline_seconds':75}
        self.last_run=run
        session=None
        try:
            PatientArguments.model_validate_json(json.dumps({'patient_id':pid}))
            session,snapshot=self.prepare(pid)
            run['initial_snapshot']=snapshot
            messages=[{'role':'system','content':SYSTEM},{'role':'user','content':json.dumps({'objective':f'Investigate {pid} and select a guarded business intervention.', 'initial_snapshot':snapshot})}]
            for _ in range(self.max_iterations):
                definitions=serving_tools(session,run['optional_investigation_calls'])
                message=self.inference(messages,definitions,run)
                calls=message.get('tool_calls') or []
                if len(calls)!=1:
                    raise AgentFailure('Expected one registered structured decision/investigation call; no fabricated result returned')
                call=calls[0]
                name=call.get('function',{}).get('name')
                raw=call.get('function',{}).get('arguments')
                if name not in {t['function']['name'] for t in definitions}:
                    raise AgentFailure('Model selected an unregistered/unavailable function')
                if not isinstance(raw,str) or len(raw)>8000:
                    raise AgentFailure('Malformed or oversized model arguments')
                run['last_model_function']={'name':name,'arguments':json.loads(raw)}
                remaining()
                if name in ('compare_patient_patterns','get_additional_visit_history'):
                    args=PatientArguments.model_validate_json(raw)
                    if args.patient_id!=pid: raise ToolPolicyError('Optional investigation cannot change patients')
                    if name=='compare_patient_patterns': result=session.patterns()
                    else: result={'visits':safe_visits(session.cache['get_patient_history']['visits']),
                                  'visits_returned':session.cache['get_patient_history'].get('visits_returned',len(session.cache['get_patient_history']['visits'])),'history_limit':100}
                    register_evidence(session,name,result,call['id'])
                    session.trace_event('INVESTIGATE','Model requested additional investigation','Retrieved additional observed evidence; no inferred causes.',name,call['id'])
                    run['optional_investigation_calls']+=1
                    result={'result':result,'evidence':list(session.evidence.values())}
                elif name=='diagnose_and_simulate':
                    args=DiagnosisPlan.model_validate_json(raw)
                    if args.patient_id!=pid: raise ToolPolicyError('Diagnosis cannot change patients')
                    # Check full batch eligibility before recording the hypothesis.
                    if len(set(args.interventions))!=len(args.interventions): raise ToolPolicyError('Duplicate intervention in batch')
                    session.validate_diagnosis(args.diagnosis)
                    session.resolve_evidence(args.evidence_ids)
                    diagnosis_args=DecisionArguments.model_validate_json(json.dumps({
                        'patient_id':pid,'phase':'DIAGNOSE','diagnosis':args.diagnosis.value,'confidence':args.confidence,
                        'evidence_ids':args.evidence_ids,'rationale':args.rationale,'intervention':None}))
                    session.record_decision(diagnosis_args,call['id'])
                    results=self.batch(session,args.interventions)
                    result={'diagnosis':session.diagnosis,'simulations':results,'value_type':'SIMULATED',
                            'next':'Compare these calculated results and select_intervention. Python handles ACT and MEASURE.'}
                else:
                    args=SelectionArguments.model_validate_json(raw)
                    if args.patient_id!=pid: raise ToolPolicyError('Selection cannot change patients')
                    if args.intervention.value not in session.simulations: raise ToolPolicyError('Select only a simulated intervention')
                    cited=set(args.simulation_ids)
                    known={r['simulation_id'] for r in session.simulations.values()}
                    if not cited<=known or session.simulations[args.intervention.value]['simulation_id'] not in cited:
                        raise ToolPolicyError('Cite exact simulation IDs, including the selected option')
                    # Python already supplies the baseline comparison in every batch.
                    # Citation omission is not fabricated evidence; unknown IDs still fail.
                    cited.add(session.simulations['NO_ACTION']['simulation_id'])
                    decision_args=DecisionArguments.model_validate_json(json.dumps({'patient_id':pid,'phase':'DECIDE',
                        'diagnosis':session.diagnosis['category'],'confidence':session.diagnosis['confidence'],
                        'evidence_ids':args.evidence_ids,'rationale':args.rationale,'intervention':args.intervention.value}))
                    result=session.record_decision(decision_args,call['id'])
                    session.case['decision']['simulation_evidence']=[r for r in session.simulations.values() if r['simulation_id'] in cited]
                run['tool_calls'].append({'order':len(run['tool_calls'])+1,'model_call':run['model_calls'],'tool':name,
                    'tool_call_id':call['id'],'arguments':json.loads(raw),'result':result,'status':'COMPLETED'})
                if name=='select_intervention':
                    # Native model selection is final. Mechanical execution is Python-only.
                    case=session.case
                    run['status']='PERSISTING'
                    case['agent_run']=run
                    action_args=InterventionArguments.model_validate_json(json.dumps({'patient_id':pid,'intervention':args.intervention.value}))
                    session.create_action(action_args,'python:ACT',persist=False)
                    run['final_decision']={'patient_id':pid,'diagnosis':case['diagnosis']['category'],
                        'intervention':case['action']['type'],'decision_id':case['decision']['decision_id'],'action_id':case['action']['action_id']}
                    # Keep a validated checkpoint even if the first write fails after a commit.
                    self.service.pending_cases[pid]=case
                    self.service.complete_persistence(case,start)
                    return case
                messages.append({'role':'assistant','content':None,'tool_calls':calls})
                messages.append({'role':'tool','tool_call_id':call['id'],'content':json.dumps(result)})
            raise AgentFailure('Optional investigation/model response budget exhausted; no fabricated result returned')
        except (ValidationError,ToolPolicyError) as exc:
            run.update(status='FAILED',error=f'Invalid model arguments or evidence: {exc.__class__.__name__}: {str(exc)[:1000]}')
            raise AgentFailure(run['error']) from exc
        except Exception as exc:
            run.update(status='FAILED',error=str(exc)[:1000])
            raise
        finally:
            if run['status']!='COMPLETED':
                run['runtime_seconds']=round(time.monotonic()-start,3)
                run['tool_calls_count']=len(run['tool_calls'])
