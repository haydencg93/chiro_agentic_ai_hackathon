from threading import RLock
from uuid import uuid4, uuid5, NAMESPACE_URL
import time
from .schemas import Case
from .runtime import ACTIVE_RUN, request_deadline, remaining

LIMITATIONS = [
    'Synthetic source data. Generator churn scores and patient statuses are excluded.',
    'No future-appointment signal: generator does not produce future bookings.',
    'Analysis date is the latest observed appointment/visit date, not today.',
    'Heuristic risk score is not a calibrated churn probability.',
    'Intervention probabilities and costs are demonstration assumptions, not learned effects.',
    'Actions record software tasks only; no patient messages are sent.',
]

class Conflict(RuntimeError):
    pass

class RetentionService:
    def __init__(self, tools, ledger, agent=None):
        self.tools, self.ledger = tools, ledger
        self.agent = agent
        self.lock = RLock()
        self.pending_cases = {}
    @staticmethod
    def patient_id(value):
        return value[5:] if value.startswith('CASE-') else value
    def build_case(self, m, patient=None):
        pid = str(m['patient_id'])
        signals = []
        for kind, label, value in [('VISIT_FREQUENCY','90-day visit decline', m['decline']),
                                  ('CANCELLATION','90-day missed appointment rate', m['miss_rate']),
                                  ('LAST_VISIT','Days since last observed visit', m['gap_days'])]:
            if value:
                signals.append(dict(type=kind,label=label,value=str(value),detail='Derived from observed visits and appointments at the snapshot date.',severity=m['level']))
        return Case(case_id=f'CASE-{pid}',patient=patient or {'patient_id':pid},
                    risk={'level':m['level'],'score':m['score'],'revenue_at_risk':m['revenue_at_risk']},
                    signals=signals, as_of_date=m['as_of_date'], limitations=LIMITATIONS,
                    last_visit_label=f"{m['gap_days']} days before snapshot" if m['gap_days'] is not None else 'No observed visits').model_dump()
    def cases(self):
        stored = {c['patient']['patient_id']:c for c in self.ledger.all()}
        queued = [stored.get(m['patient_id']) or self.build_case(m) for m in self.tools.find_revenue_risk_patients() if m['score']>0]
        queued_ids = {c['patient']['patient_id'] for c in queued}
        return queued + [c for pid,c in stored.items() if pid not in queued_ids]
    def get(self, value):
        pid = self.patient_id(value)
        stored = self.ledger.get(pid)
        if stored:
            return stored
        history = self.tools.get_patient_history(pid)
        p = history['patient']
        patient = p
        return self.build_case(self.tools.calculate_revenue_at_risk(pid), patient)
    def event(self, c, stage, title, summary, tool=None, status='COMPLETED'):
        c['trace'].append(dict(id=str(uuid4()), stage=stage, type='TOOL_CALL' if tool else 'WORKFLOW',
                               title=title,summary=summary,tool=tool,status=status))
    def run(self, value):
        if not ACTIVE_RUN.acquire(blocking=False):
            raise Conflict('Another agent run is active; please wait for it to finish before retrying')
        try:
            with request_deadline(75):
                return self._run(value)
        finally:
            ACTIVE_RUN.release()
    def complete_persistence(self,c,start=None):
        remaining()
        run=c['agent_run']
        Case.model_validate(c)
        if c['decision']['intervention']!=c['action']['type'] or run['final_decision']['action_id']!=c['action']['action_id']:
            raise Conflict('Persisted decision/action checkpoint is inconsistent')
        from .agent_tools import approval_policy
        chosen=next(i for i in c['interventions'] if i['selected'])
        required,_=approval_policy(c['action']['type'],chosen['estimated_cost'],chosen['expected_recovery'])
        if (required or c['action']['requires_approval']) and c['action']['status']=='EXECUTED' and c['action'].get('approval_status')!='APPROVED':
            raise Conflict('Execution cannot bypass deterministic approval policy')
        run.pop('error',None)
        run['status']='PERSISTING'
        # ACT checkpoint precedes MEASURE and contains the validated model choice.
        self.ledger.save(c)
        remaining()
        if c['action']['status']=='EXECUTED' and not c.get('outcome'):
            self.measure(c)
        run['status']='COMPLETED'
        run['runtime_seconds']=round(time.monotonic()-start,3) if start is not None else run.get('runtime_seconds',0)
        run['tool_calls_count']=len(run.get('tool_calls',[]))
        self.ledger.save(c)
        remaining()
        self.pending_cases.pop(c['patient']['patient_id'],None)
        return c
    def _run(self, value):
        with self.lock:
            if self.agent is not None:
                pid = self.patient_id(value)
                stored = self.pending_cases.get(pid) or self.ledger.get(pid)
                remaining()
                if stored and stored.get('orchestration_mode') == 'llm' and stored.get('action'):
                    if (stored.get('agent_run') or {}).get('status') != 'COMPLETED':
                        if (stored.get('agent_run') or {}).get('architecture')=='snapshot_two_decisions':
                            # Resume only deterministic persistence; never rerun inference or ACT.
                            self.pending_cases[pid]=stored
                            return self.complete_persistence(stored)
                        raise Conflict('An earlier action exists; inspect its recorded state before retrying')
                    return stored
                return self.agent.run(pid)
            c = self.get(value)
            if c['action']:
                return c  # Repeated frontend clicks are idempotent.
            pid = c['patient']['patient_id']
            history = self.tools.get_patient_history(pid)
            behavior = self.tools.get_appointment_behavior(pid)
            self.event(c,'OBSERVE','Behavioral risk detected',f"Heuristic score {c['risk']['score']}; estimated 90-day exposure ${c['risk']['revenue_at_risk']}.")
            self.event(c,'INVESTIGATE','Patient history retrieved',f"Retrieved {len(history['visits'])} recent history rows (maximum 100).",'get_patient_history')
            self.event(c,'INVESTIGATE','Appointment behavior retrieved',f"{behavior['missed_appointments']} missed of {behavior['recent_appointments']} observed appointments in 90 days.",'get_appointment_behavior')
            self.event(c,'INVESTIGATE','Revenue exposure calculated',c['risk']['basis'],'calculate_revenue_at_risk')
            c['investigate'] = {'visit_history':[], 'recent_activity':[{'label':c['as_of_date'],'detail':f"{behavior['missed_appointments']} missed appointments in the previous 90 days",'status':'NEUTRAL'}]}
            c['diagnosis'] = {'category':'BEHAVIORAL_DISENGAGEMENT','label':'Operational review needed', 'confidence':None,
                              'explanation':'Deterministic rule: observed gaps, visit decline, or missed appointments warrant staff review. These data cannot establish clinical, scheduling, or affordability causes.'}
            self.event(c,'DIAGNOSE','Operational hypothesis recorded',c['diagnosis']['explanation'])
            options = [('NONE','No Action',.10,0),('OUTREACH','Staff Outreach',.35,18),('SCHEDULING','Scheduling Assistance',.45 if int(behavior['missed_appointments']) else .30,8)]
            for key,name,prob,cost in options:
                recovery=round(c['risk']['revenue_at_risk']*prob,2)
                c['interventions'].append(dict(intervention_id=key,name=name,description='Synthetic scenario assumptions; no causal effect has been validated.',
                    expected_recovery=recovery, estimated_cost=cost, net_value=round(recovery-cost,2), recovery_probability=prob, requires_approval=key!='NONE',selected=False))
            best = max(c['interventions'],key=lambda i:i['net_value'])
            best['selected'] = True
            self.event(c,'SIMULATE','Interventions compared','Expected value = estimated exposure × assumed recovery probability − assumed cost.')
            self.event(c,'DECIDE','Deterministic selection',f"{best['name']} has the highest assumed net value (${best['net_value']}).")
            c['action'] = dict(action_id=str(uuid4()),type=best['intervention_id'],status='PENDING_APPROVAL' if best['requires_approval'] else 'RECORDED',
                requires_approval=best['requires_approval'],approval_status='PENDING' if best['requires_approval'] else None,
                description=f"Demo task: {best['name']}",assignee='Scheduling Team',priority=c['risk']['level'],task_type='Local demonstration task',
                due_date='After approval',notes='Approval authorizes recording a simulated task only; no patient contact.', persistence='local_sqlite')
            c['status'] = 'AWAITING_APPROVAL' if best['requires_approval'] else 'ACTIONED'
            self.event(c,'ACT','Demo action recorded','Local ledger entry; no external action executed.',status='WAITING' if best['requires_approval'] else 'COMPLETED')
            if not best['requires_approval']:
                self.measure(c)
            self.ledger.save(c)
            return c
    def measure(self,c):
        if c.get('outcome'):
            return
        best = next(i for i in c['interventions'] if i['selected'])
        c['outcome'] = dict(outcome_id=str(uuid5(NAMESPACE_URL,c['action']['action_id']+':measure:demo-v1')),
                            simulation_method='demo-v1: expectation-only; reengagement not sampled',simulated_revenue_recovered=0,value_type='SIMULATED',status='SIMULATED',reengaged=False,revenue_recovered=0,estimated_cost=best['estimated_cost'],net_recovered=0,running_total=0,
                            simulated_expected_recovery=best['expected_recovery'], simulated_expected_net_value=best['net_value'],
                            observed_revenue_recovered=0,detail='Scenario expectation only. Rebooking and recovered revenue have not been observed.')
        self.event(c,'MEASURE','Scenario expectation recorded',f"Simulated expected recovery ${best['expected_recovery']}; observed recovered revenue $0.")
    def approval(self,value,approve=True,by_action=False):
        with self.lock:
            if by_action:
                c = next((c for c in self.ledger.all() if c.get('action',{}).get('action_id')==value),None)
                if c is None:
                    raise KeyError(value)
            else:
                c = self.get(value)
            action=c.get('action')
            if not action:
                raise Conflict('Run this case before approving an action')
            target='APPROVED' if approve else 'REJECTED'
            if action['approval_status']==target:
                return c
            if action['status']!='PENDING_APPROVAL':
                raise Conflict('Action is not pending approval')
            executed_status = 'EXECUTED' if c.get('orchestration_mode') == 'llm' else 'RECORDED'
            action.update(approval_status=target,status=executed_status if approve else 'REJECTED')
            c['status']='ACTIONED' if approve else 'REVIEW'
            self.event(c,'ACT','Demo task approved' if approve else 'Demo task rejected','Decision saved in local ledger; no patient contact.')
            if approve:
                self.ledger.save(c)
                self.measure(c)
            self.ledger.save(c)
            return c
    def summary(self):
        cases=self.cases()
        return dict(cases_detected=len(cases),high_risk_cases=sum(c['risk']['level']=='HIGH' for c in cases),
                    revenue_at_risk=round(sum(c['risk']['revenue_at_risk'] for c in cases),2),
                    potentially_recoverable=round(sum(next((i['expected_recovery'] for i in c['interventions'] if i.get('selected')),0) for c in cases),2),
                    revenue_recovered=0, observed_revenue_recovered=0,
                    simulated_expected_recovery=round(sum((c.get('outcome') or {}).get('simulated_expected_recovery',0) for c in cases),2),
                    actions_executed=sum((c.get('action') or {}).get('status') == 'EXECUTED' for c in cases),actions_recorded=sum(bool(c['action']) for c in cases),
                    awaiting_approval=sum(c['status']=='AWAITING_APPROVAL' for c in cases),
                    scope='Top 100 cases from 1000 candidates ranked by baseline revenue; not a whole-business total',
                    orchestration_mode='llm' if self.agent else 'deterministic', revenue_series=[], revenue_labels=[])
