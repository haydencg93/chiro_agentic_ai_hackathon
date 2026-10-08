"""Read-only Databricks tools. No use of generator churn scores/statuses."""
from .databricks import DataUnavailable
from .tool_models import Patient, PatientHistory, AppointmentBehavior, RevenueRisk

class DataTools:
    def __init__(self, sql):
        self.sql = sql
        self._columns = {}
    def column(self, table, *candidates):
        if table not in self._columns:
            self._columns[table] = {r['col_name'] for r in self.sql.query(f"DESCRIBE TABLE {self.sql.table(table)}")}
        for name in candidates:
            if name in self._columns[table]:
                return f"`{name}`"
        raise DataUnavailable(f"Required column missing in {table}: {', '.join(candidates)}")
    def get_patient_history(self, patient_id, patient=None):
        patient = patient or self.require_patient(patient_id)
        vd = self.column('visits', 'visit_date', 'visit_datetime', 'visit_timestamp')
        visits = self.sql.query(f"SELECT * FROM {self.sql.table('visits')} WHERE patient_id = :patient_id ORDER BY {vd} DESC LIMIT 100", {'patient_id':patient_id})
        return PatientHistory(patient=patient, visits=visits, visits_returned=len(visits)).model_dump(mode='json')
    def require_patient(self, patient_id):
        rows = self.sql.query(f"SELECT * FROM {self.sql.table('patients')} WHERE patient_id = :patient_id LIMIT 1", {'patient_id':patient_id})
        if not rows:
            raise KeyError(patient_id)
        return Patient.model_validate(rows[0]).model_dump(mode='json')
    def get_appointment_behavior(self, patient_id):
        self.require_patient(patient_id)
        return self.behavior_from_risk(self.calculate_revenue_at_risk(patient_id))
    @staticmethod
    def behavior_from_risk(risk):
        return AppointmentBehavior(as_of_date=risk['as_of_date'],recent_appointments=risk['appointments'],
            missed_appointments=risk['missed'],missed_rate=risk['miss_rate'],
            completed_appointments=risk.get('completed_appointments',0),
            cancelled_appointments=risk.get('cancelled_appointments',0),
            no_show_appointments=risk.get('no_show_appointments',0)).model_dump(mode='json')
    def initial_evidence(self, patient_id):
        patient=self.require_patient(patient_id)
        risk=self.calculate_revenue_at_risk(patient_id)
        history=self.get_patient_history(patient_id,patient=patient)
        return history,self.behavior_from_risk(risk),risk
    def metrics(self, patient_id=None, limit=100):
        vd = self.column('visits', 'visit_date', 'visit_datetime', 'visit_timestamp')
        rev = self.column('visits', 'revenue', 'total_revenue', 'visit_revenue', 'amount_paid', 'total_amount')
        ad = self.column('appointments', 'appointment_date', 'scheduled_date', 'appointment_datetime', 'appointment_timestamp')
        status = self.column('appointments', 'status', 'appointment_status')
        where = 'WHERE p.patient_id = :patient_id' if patient_id else ''
        return self.sql.query(f"""
        WITH anchor AS (SELECT greatest((SELECT max(cast({vd} AS DATE)) FROM {self.sql.table('visits')}),
          (SELECT max(cast({ad} AS DATE)) FROM {self.sql.table('appointments')})) AS d),
        v AS (SELECT patient_id, max(cast({vd} AS DATE)) AS last_visit,
          count_if(cast({vd} AS DATE) > date_sub(d,90) AND cast({vd} AS DATE)<=d) AS recent_visits,
          count_if(cast({vd} AS DATE) > date_sub(d,180) AND cast({vd} AS DATE)<=date_sub(d,90)) AS prior_visits,
          avg(CASE WHEN cast({vd} AS DATE)>date_sub(d,180) AND cast({vd} AS DATE)<=d THEN greatest(cast({rev} AS DOUBLE),0) END) AS mean_revenue
          FROM {self.sql.table('visits')} CROSS JOIN anchor GROUP BY patient_id),
        a AS (SELECT patient_id,
          count_if(cast({ad} AS DATE)>date_sub(d,90) AND cast({ad} AS DATE)<=d) AS appointments,
          count_if(cast({ad} AS DATE)>date_sub(d,90) AND cast({ad} AS DATE)<=d AND lower({status}) IN
           ('cancelled','canceled','no_show','no-show','no show')) AS missed,
          count_if(cast({ad} AS DATE)>date_sub(d,90) AND cast({ad} AS DATE)<=d AND lower({status})='completed') AS completed_appointments,
          count_if(cast({ad} AS DATE)>date_sub(d,90) AND cast({ad} AS DATE)<=d AND lower({status}) IN ('cancelled','canceled')) AS cancelled_appointments,
          count_if(cast({ad} AS DATE)>date_sub(d,90) AND cast({ad} AS DATE)<=d AND lower({status}) IN ('no_show','no-show','no show')) AS no_show_appointments
          FROM {self.sql.table('appointments')} CROSS JOIN anchor GROUP BY patient_id)
        SELECT cast(p.patient_id AS STRING) AS patient_id, cast(d AS STRING) AS as_of_date,
          datediff(d,v.last_visit) AS gap_days, coalesce(v.recent_visits,0) AS recent_visits,
          coalesce(v.prior_visits,0) AS prior_visits, coalesce(v.mean_revenue,0) AS mean_revenue,
          coalesce(a.appointments,0) AS appointments, coalesce(a.missed,0) AS missed, coalesce(a.completed_appointments,0) AS completed_appointments,
          coalesce(a.cancelled_appointments,0) AS cancelled_appointments, coalesce(a.no_show_appointments,0) AS no_show_appointments
        FROM {self.sql.table('patients')} p CROSS JOIN anchor
        LEFT JOIN v ON p.patient_id=v.patient_id LEFT JOIN a ON p.patient_id=a.patient_id {where}
        ORDER BY (coalesce(v.prior_visits,0)*coalesce(v.mean_revenue,0)) DESC, p.patient_id
        LIMIT {int(limit)}""", {'patient_id':patient_id} if patient_id else None)
    def calculate_revenue_at_risk(self, patient_id):
        rows = self.metrics(patient_id)
        if not rows:
            raise KeyError(patient_id)
        return calculate_risk(rows[0])
    def find_revenue_risk_patients(self, limit=100):
        # Bounded candidate pool; explicitly not a whole-catalog total.
        return sorted([calculate_risk(r) for r in self.metrics(limit=1000)], key=lambda r:r['revenue_at_risk'], reverse=True)[:limit]

def calculate_risk(row):
    r = dict(row)
    if not r.get('as_of_date'):
        raise DataUnavailable('No dated visits or appointments found in the dataset')
    recent, prior = int(r['recent_visits']), int(r['prior_visits'])
    gap = int(r['gap_days']) if r['gap_days'] is not None else None
    missed, appointments = int(r['missed']), int(r['appointments'])
    decline = max(0, (prior-recent)/prior) if prior >= 2 else 0
    miss_rate = missed/appointments if appointments else 0
    gap_signal = min(1, max(0,(gap-30)/60)) if gap is not None and recent+prior >= 2 else 0
    score = round(min(1, .45*decline + .30*miss_rate + .25*gap_signal), 4)
    baseline = max(prior,recent)
    exposure = round(baseline * float(r['mean_revenue']) * score,2)
    r.update(score=score, revenue_at_risk=exposure, level='HIGH' if score>=.6 else 'MEDIUM' if score>=.3 else 'LOW',
             decline=round(decline,4), miss_rate=round(miss_rate,4), horizon_days=90)
    return RevenueRisk.model_validate(r).model_dump(mode='json')
