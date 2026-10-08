"""Bounded tools, deterministic scenario economics, and action policy."""
import json
from decimal import Decimal, ROUND_HALF_UP
from uuid import uuid4
from .tool_models import (
    PatientArguments, InterventionArguments, DecisionArguments, Diagnosis,
    Intervention, PatientPatterns, Economics,
)

class ToolPolicyError(ValueError):
    pass

# All probabilities and costs are declared demonstration assumptions, not causal estimates.
CATALOG = {
    Intervention.STAFF_OUTREACH: ('Staff Outreach', '.35', '18'),
    Intervention.SCHEDULING_ASSISTANCE: ('Scheduling Assistance', '.45', '8'),
    Intervention.ALTERNATE_LOCATION: ('Alternate Location Review', '.30', '12'),
    Intervention.ALTERNATE_PROVIDER: ('Alternate Provider Review', '.30', '12'),
    Intervention.VALUE_EDUCATION: ('Value Education', '.25', '12'),
    Intervention.DISCOUNT: ('15% Retention Discount', '.50', '5'),
    Intervention.NO_ACTION: ('No Action', '.10', '0'),
}

def money(value):
    return Decimal(str(value)).quantize(Decimal('.01'), rounding=ROUND_HALF_UP)

def approval_policy(intervention, cost, recovery):
    if intervention == Intervention.DISCOUNT:
        return True, 'Any financial incentive requires manager approval'
    if intervention == Intervention.ALTERNATE_PROVIDER:
        return True, 'Provider change review is high impact'
    if cost >= 50 or recovery >= 1000:
        return True, 'Demo approval threshold: cost >= $50 or expected recovery >= $1000'
    return False, None

def simulate_economics(intervention, exposure, missed_count=0, catalog_row=None):
    intervention = Intervention(intervention)
    name, probability, base_cost = CATALOG[intervention]
    if catalog_row is not None:
        base_cost = str(catalog_row['estimated_cost'])
    if intervention == Intervention.SCHEDULING_ASSISTANCE and not missed_count:
        probability = '.30'
    gross = money(Decimal(str(exposure)) * Decimal(probability))
    cost = money(base_cost)
    if intervention == Intervention.DISCOUNT:
        cost = money(cost + money(gross * Decimal('.15')))
    required, reason = approval_policy(intervention, cost, gross)
    if catalog_row and catalog_row['requires_approval']:
        required, reason = True, reason or 'Controlled Delta catalog requires approval'
    baseline = money(Decimal(str(exposure)) * Decimal('.10'))
    return Economics(intervention_id=intervention, name=name,
        description='SIMULATED demo-v1 assumptions; recovery probabilities are unvalidated.',
        expected_recovery=float(gross), estimated_cost=float(cost), net_value=float(gross-cost),
        recovery_probability=float(probability), requires_approval=required, approval_reason=reason,
        incremental_net_value=float(gross-cost-baseline)).model_dump(mode='json')

TOOL_ARGUMENTS = {
    'get_patient_history': PatientArguments,
    'get_appointment_behavior': PatientArguments,
    'calculate_revenue_at_risk': PatientArguments,
    'compare_patient_patterns': PatientArguments,
    'get_intervention_options': PatientArguments,
    'simulate_intervention': InterventionArguments,
    'create_outreach_task': InterventionArguments,
    'record_agent_decision': DecisionArguments,
}
DESCRIPTIONS = {
    'get_patient_history': 'Read up to 100 observed visits and safe patient attributes; excludes generator churn/status and nonexistent contact fields.',
    'get_appointment_behavior': 'Read 90-day appointment counts and missed rate. Unknown patients fail. Future bookings are not a signal.',
    'calculate_revenue_at_risk': 'Python/SQL calculates visit decline, gap, mean revenue, heuristic risk score and estimated 90-day exposure. Never calculate these yourself.',
    'compare_patient_patterns': 'Compare recent/prior visit windows and observed location/provider identifier changes. Changes do not prove friction.',
    'get_intervention_options': 'Get the controlled intervention catalog, demo assumptions and deterministic approval policy.',
    'simulate_intervention': 'Calculate SIMULATED recovery, costs, net value and approval for one catalog intervention. Compare at least two including NO_ACTION.',
    'record_agent_decision': 'DIAGNOSE records an operational hypothesis with at least two evidence_ids from tool replies and null intervention, before simulation. DECIDE records the same diagnosis and a simulated intervention after comparison. Rationale is a concise evidence-based audit summary, never private reasoning. Evidence IDs resolve to exact typed tool values in Python.',
    'create_outreach_task': 'Actually persist the selected action in the configured durable ledger after DECIDE. Operational tasks may execute locally; financial/high-impact tasks are PENDING_APPROVAL. No external messages or pricing changes. Cannot bypass policy.',
}

def native_tools():
    # Inline Pydantic references: the serving API's function parser must see enums
    # and nested argument fields directly rather than opaque local $defs references.
    def inline(node, definitions):
        if isinstance(node,list):
            return [inline(value,definitions) for value in node]
        if not isinstance(node,dict):
            return node
        if '$ref' in node:
            return inline(definitions[node['$ref'].split('/')[-1]],definitions)
        return {key:inline(value,definitions) for key,value in node.items() if key not in ('$defs','title')}
    result=[]
    for name,schema in TOOL_ARGUMENTS.items():
        raw=schema.model_json_schema()
        result.append({'type':'function','function':{'name':name,'description':DESCRIPTIONS[name],
                      'parameters':inline(raw,raw.get('$defs',{}))}})
    return result

def available_tools(session, remaining_rounds):
    """Expose legal choices under lifecycle guards, without prescribing read order."""
    if session.action:
        return []
    if session.decision:
        names={'create_outreach_task'}
    else:
        completed={entry['tool'] for entry in session.results.values()}
        names=set(TOOL_ARGUMENTS)-{'create_outreach_task'}
        names -= completed & {'get_patient_history','get_appointment_behavior','calculate_revenue_at_risk','compare_patient_patterns','get_intervention_options'}
        if not session.diagnosis:
            names.discard('simulate_intervention')
            if 'calculate_revenue_at_risk' not in completed:
                names.discard('record_agent_decision')
        elif len(session.simulations)<2 or 'NO_ACTION' not in session.simulations:
            names.discard('record_agent_decision')
        # Preserve enough rounds for required guarded stages through the terminal action.
        minimum=(int('calculate_revenue_at_risk' not in completed)+int(not session.diagnosis)
                 +max(0,2-len(session.simulations))
                 +int(len(session.simulations)>=2 and 'NO_ACTION' not in session.simulations)+2)
        if remaining_rounds<=minimum:
            names -= {'get_patient_history','get_appointment_behavior','compare_patient_patterns','get_intervention_options'}
    definitions=[tool for tool in native_tools() if tool['function']['name'] in names]
    for tool in definitions:
        if tool['function']['name']=='record_agent_decision':
            properties=tool['function']['parameters']['properties']
            properties['phase']={'type':'string','enum':['DECIDE' if session.diagnosis else 'DIAGNOSE']}
            if not session.diagnosis:
                properties['intervention']={'type':'null'}
            else:
                properties['intervention']={'type':'string','enum':list(session.simulations)}
                properties['diagnosis']={'type':'string','enum':[session.diagnosis['category']]}
    return definitions

class AgentToolSession:
    def __init__(self, patient_id, tools, service, patient):
        self.patient_id, self.tools, self.service = patient_id, tools, service
        self.patient = patient
        self.cache = {}
        self.results = {}
        self.evidence = {}
        self.simulations = {}
        self.diagnosis = None
        self.decision = None
        self.action = None
        self.case = None
        self.trace = []
        self.trace_event('OBSERVE','Synthetic patient verified',f'Observed source patient {patient_id}; investigate behavior before choosing an action.')
    def trace_event(self,stage,title,summary,tool=None,call_id=None,**extra):
        status = extra.pop('status', 'COMPLETED')
        self.trace.append(dict(id=str(uuid4()),stage=stage,type='TOOL_CALL' if tool else 'WORKFLOW',title=title,
                               summary=summary,status=status,tool=tool,tool_call_id=call_id,**extra))
    def catalog(self):
        if hasattr(self.service.ledger,'interventions'):
            if '_catalog' not in self.cache:
                self.cache['_catalog']=self.service.ledger.interventions()
            return self.cache['_catalog']
        # Explicit local/test catalog, never used for normal Delta operation.
        return {k.value:dict(estimated_cost=float(v[2]),requires_approval=k in (Intervention.DISCOUNT,Intervention.ALTERNATE_PROVIDER)) for k,v in CATALOG.items()}
    def read(self,name):
        if name not in self.cache:
            self.cache[name] = getattr(self.tools,name)(self.patient_id)
        return self.cache[name]
    def risk(self):
        return self.read('calculate_revenue_at_risk')
    def patterns(self):
        if 'compare_patient_patterns' in self.cache:
            return self.cache['compare_patient_patterns']
        m=self.risk()
        sql=self.tools.sql
        vd=self.tools.column('visits','visit_date')
        rows=sql.query(f"""SELECT
            to_json(collect_set(CASE WHEN {vd}>date_sub(cast(:as_of AS DATE),90) AND {vd}<=cast(:as_of AS DATE) THEN location_id END)) AS recent_locations,
            to_json(collect_set(CASE WHEN {vd}>date_sub(cast(:as_of AS DATE),180) AND {vd}<=date_sub(cast(:as_of AS DATE),90) THEN location_id END)) AS prior_locations,
            to_json(collect_set(CASE WHEN {vd}>date_sub(cast(:as_of AS DATE),90) AND {vd}<=cast(:as_of AS DATE) THEN provider_id END)) AS recent_providers,
            to_json(collect_set(CASE WHEN {vd}>date_sub(cast(:as_of AS DATE),180) AND {vd}<=date_sub(cast(:as_of AS DATE),90) THEN provider_id END)) AS prior_providers
            FROM {sql.table('visits')} WHERE patient_id=:patient_id""",{'patient_id':self.patient_id,'as_of':m['as_of_date']})[0]
        sets={k:set(json.loads(v or '[]')) for k,v in rows.items()}
        recent_l,prior_l=sets['recent_locations'],sets['prior_locations']
        recent_p,prior_p=sets['recent_providers'],sets['prior_providers']
        result=PatientPatterns(patient_id=self.patient_id,as_of_date=m['as_of_date'],recent_visits=m['recent_visits'],prior_visits=m['prior_visits'],
            decline=m['decline'],gap_days=m['gap_days'],recent_distinct_locations=len(recent_l),prior_distinct_locations=len(prior_l),
            recent_distinct_providers=len(recent_p),prior_distinct_providers=len(prior_p),
            location_change_observed=bool(recent_l and prior_l and recent_l!=prior_l),
            provider_change_observed=bool(recent_p and prior_p and recent_p!=prior_p)).model_dump(mode='json')
        self.cache['compare_patient_patterns']=result
        return result
    def resolve_evidence(self,ids):
        if len(set(ids))<2 or any(key not in self.evidence for key in ids):
            raise ToolPolicyError('Cite at least two distinct evidence_ids exactly as supplied in successful tool replies')
        return [self.evidence[key] for key in ids]
    def validate_diagnosis(self,diagnosis):
        m=self.risk()
        if diagnosis==Diagnosis.VALUE_CONCERN:
            raise ToolPolicyError('No affordability or value-concern evidence exists in these tables')
        if diagnosis==Diagnosis.REPEATED_MISSED_APPOINTMENTS and m['missed']<2:
            raise ToolPolicyError('Repeated missed appointments requires at least two observed misses')
        if diagnosis==Diagnosis.SCHEDULING_FRICTION and not m['missed']:
            raise ToolPolicyError('Scheduling-friction hypothesis requires observed missed appointments')
        if diagnosis==Diagnosis.VISIT_FREQUENCY_DECLINE and not m['decline']:
            raise ToolPolicyError('No visit-frequency decline observed')
        for category,key in [(Diagnosis.LOCATION_FRICTION,'location_change_observed'),(Diagnosis.PROVIDER_FRICTION,'provider_change_observed')]:
            if diagnosis==category and not self.cache.get('compare_patient_patterns',{}).get(key):
                raise ToolPolicyError('Read compare_patient_patterns and establish observed identifier changes first')
    def record_decision(self,args,call_id):
        if 'calculate_revenue_at_risk' not in {r['tool'] for r in self.results.values()}:
            raise ToolPolicyError('Call calculate_revenue_at_risk before recording a diagnosis or decision')
        evidence = self.resolve_evidence(args.evidence_ids)
        self.validate_diagnosis(args.diagnosis)
        diagnosis=dict(category=args.diagnosis.value,label=args.diagnosis.value.replace('_',' ').title(),confidence=args.confidence,
                       confidence_basis='Model self-assessment, not calibrated',kind='OPERATIONAL_HYPOTHESIS',
                       explanation=args.rationale,evidence=evidence)
        if args.phase=='DIAGNOSE':
            if self.diagnosis or self.simulations or self.decision:
                raise ToolPolicyError('Record DIAGNOSE before simulations; diagnosis is immutable for this run')
            if args.intervention is not None:
                raise ToolPolicyError('DIAGNOSE requires null intervention')
            self.diagnosis=diagnosis
            self.trace_event('DIAGNOSE','Model operational hypothesis',args.rationale,'record_agent_decision',call_id,confidence=args.confidence,evidence=diagnosis['evidence'])
            return {'diagnosis':diagnosis,'next':'Compare at least two interventions including NO_ACTION with simulate_intervention'}
        if not self.diagnosis or args.diagnosis.value!=self.diagnosis['category']:
            raise ToolPolicyError('DECIDE must use the diagnosis recorded in DIAGNOSE')
        if self.decision:
            raise ToolPolicyError('Decision already recorded and immutable')
        if (len(self.simulations)<2 and args.intervention!=Intervention.NO_ACTION) or Intervention.NO_ACTION.value not in self.simulations:
            raise ToolPolicyError('Simulate at least two options including NO_ACTION before DECIDE')
        if args.intervention is None or args.intervention.value not in self.simulations:
            raise ToolPolicyError('Selected intervention must have a recorded simulation')
        if self.risk()['score']==0 and args.intervention!=Intervention.NO_ACTION:
            raise ToolPolicyError('No behavioral risk evidence: only NO_ACTION is eligible')
        self.decision=dict(decision_id=str(uuid4()),patient_id=self.patient_id,diagnosis=args.diagnosis.value,
                           intervention=args.intervention.value,rationale=args.rationale,evidence=diagnosis['evidence'])
        self.trace_event('DECIDE','Model intervention selected',args.rationale,'record_agent_decision',call_id,evidence=diagnosis['evidence'])
        self.case=self.service.build_case(self.risk(),self.patient)
        self.case.update(orchestration_mode='llm',diagnosis=self.diagnosis,issue=self.diagnosis['label'],trace=self.trace,
                         interventions=[dict(s,selected=k==args.intervention.value) for k,s in self.simulations.items()])
        self.case['decision']=self.decision
        history=self.cache.get('get_patient_history',{})
        self.case['investigate']={'visit_history':[self.risk()['prior_visits'],self.risk()['recent_visits']],
            'recent_activity':[dict(label=v['visit_date'],detail=f"Observed {v['service_type']} visit; revenue ${v['revenue']}",status='POSITIVE') for v in history.get('visits',[])[:4]]}
        return dict(self.decision,economics=self.simulations[args.intervention.value])
    def create_action(self,args,call_id,persist=True):
        if not self.decision or args.intervention.value!=self.decision['intervention']:
            raise ToolPolicyError('Action must match the immutable recorded decision')
        if self.action:
            return self.action
        simulation=self.simulations[args.intervention.value]
        # Recompute the policy from authoritative economics, never from LLM flags.
        required,reason=approval_policy(args.intervention,Decimal(str(simulation['estimated_cost'])),Decimal(str(simulation['expected_recovery'])))
        catalog_row = self.catalog().get(args.intervention.value)
        if catalog_row is None:
            raise ToolPolicyError('Intervention is not active in the controlled catalog')
        if catalog_row['requires_approval']:
            required,reason=True,reason or 'Controlled Delta catalog requires approval'
        from uuid import uuid5, NAMESPACE_URL
        action_id=str(uuid5(NAMESPACE_URL,f'{self.patient_id}:{self.case["as_of_date"]}:demo-v1:{self.service.agent.endpoint if self.service.agent else "test"}'))
        self.action=dict(action_id=action_id,type=args.intervention.value,status='PENDING_APPROVAL' if required else 'EXECUTED',
            requires_approval=required,approval_status='PENDING' if required else None,approval_reason=reason,
            description=f"Local demo task: {simulation['name']}",assignee='Practice Manager' if required else 'Scheduling Team',
            priority=self.case['risk']['level'],task_type='Local outreach task' if args.intervention!=Intervention.NO_ACTION else 'Recorded no-action decision',
            due_date='After approval' if required else 'Today',notes='Local task recorded only. No patient contact, booking or price change.',
            persistence=getattr(self.service.ledger,'persistence','local_sqlite_test_fallback'),execution_scope='SOFTWARE_TASK_ONLY',decision_id=self.decision['decision_id'])
        self.case.update(action=self.action,status='AWAITING_APPROVAL' if required else 'ACTIONED')
        self.trace_event('ACT','Approval requested' if required else 'Local task executed',self.action['notes'],'create_outreach_task',call_id,status='WAITING' if required else 'COMPLETED')
        # ACT is durably recorded before MEASURE. Repeated saves use the same IDs.
        if persist:
            self.service.ledger.save(self.case)
            if not required:
                self.service.measure(self.case)
                self.service.ledger.save(self.case)
        return self.action
    def execute(self,name,raw_arguments,call_id):
        if name not in TOOL_ARGUMENTS:
            raise ToolPolicyError('Unknown tool. Call ONLY these registered functions: '+', '.join(TOOL_ARGUMENTS))
        args=TOOL_ARGUMENTS[name].model_validate_json(raw_arguments)
        if args.patient_id!=self.patient_id:
            raise ToolPolicyError('Tools are restricted to the patient in this run')
        if self.action:
            raise ToolPolicyError('Action already recorded. Return final structured JSON with the recorded IDs.')
        if name in ('get_patient_history','get_appointment_behavior','calculate_revenue_at_risk'):
            result=self.read(name)
            if name=='get_patient_history': summary=f"Retrieved {result['visits_returned']} observed visits (limit 100); no contact data."
            elif name=='get_appointment_behavior': summary=f"{result['missed_appointments']} missed of {result['recent_appointments']} appointments in 90 days."
            else: summary=f"Gap {result['gap_days']} days; visits {result['prior_visits']} → {result['recent_visits']}; estimated exposure ${result['revenue_at_risk']}."
            self.trace_event('INVESTIGATE',name,summary,name,call_id)
        elif name=='compare_patient_patterns':
            result=self.patterns()
            self.trace_event('INVESTIGATE',name,f"Visits {result['prior_visits']} → {result['recent_visits']}; location/provider changes are hypotheses only.",name,call_id)
        elif name=='get_intervention_options':
            result={'options':[{'intervention':k,'name':CATALOG[Intervention(k)][0],'assumed_recovery_probability':float(CATALOG[Intervention(k)][1]),'base_cost':v['estimated_cost'],'requires_approval':v['requires_approval']} for k,v in self.catalog().items()],
                    'value_type':'SIMULATED','assumption_version':'demo-v1','policy':'DISCOUNT and ALTERNATE_PROVIDER require approval; cost >= $50 or expected recovery >= $1000 also requires approval.',
                    'limitation':'No causal intervention outcomes have been observed. Discounts cost $5 plus 15% of simulated gross recovery. Scheduling probability is .30 without misses.'}
            self.trace_event('INVESTIGATE',name,'Retrieved seven controlled intervention scenarios with labeled assumptions.',name,call_id)
        elif name=='simulate_intervention':
            if not self.diagnosis:
                raise ToolPolicyError('Record DIAGNOSE before simulating interventions')
            for intervention,key in [(Intervention.ALTERNATE_LOCATION,'location_change_observed'),(Intervention.ALTERNATE_PROVIDER,'provider_change_observed')]:
                if args.intervention==intervention and not self.cache.get('compare_patient_patterns',{}).get(key):
                    raise ToolPolicyError('Alternative location/provider option requires observed changes from compare_patient_patterns')
            if self.decision:
                raise ToolPolicyError('Simulations are immutable after DECIDE')
            row=self.catalog().get(args.intervention.value)
            if row is None:
                raise ToolPolicyError('Intervention is not active in the controlled catalog')
            result=simulate_economics(args.intervention,self.risk()['revenue_at_risk'],self.risk()['missed'],row)
            self.simulations[args.intervention.value]=result
            self.trace_event('SIMULATE',result['name'],f"SIMULATED recovery ${result['expected_recovery']}, cost ${result['estimated_cost']}, net ${result['net_value']}.",name,call_id)
        elif name=='record_agent_decision':
            result=self.record_decision(args,call_id)
        else:
            result=self.create_action(args,call_id)
        self.results[call_id]={'tool':name,'result':result}
        if name in ('get_patient_history','get_appointment_behavior','calculate_revenue_at_risk','compare_patient_patterns'):
            # Model cites short IDs; Python supplies exact fields and typed values.
            for field,value in result.items():
                if isinstance(value,(int,float,bool)) or field in ('as_of_date',):
                    evidence_id=f'E{len(self.evidence)+1}'
                    self.evidence[evidence_id]={'evidence_id':evidence_id,'tool_call_id':call_id,'tool':name,'field':field,'value':value}
        return result
