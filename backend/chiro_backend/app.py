import re
from threading import Lock
from .runtime import request_deadline, DeadlineExceeded
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError
from databricks.sdk.errors import DatabricksError
from .config import Settings
from .databricks import DatabricksSQL, DataUnavailable
from .tools import DataTools
from .ledger import Ledger
from .delta import DeltaLedger
from .scope import in_scope, REFUSAL
from .service import RetentionService, Conflict
from .schemas import Case, CasesResponse, RunRequest, RunResponse
from .agent import RevenueRescueAgent, DatabricksModel, AgentFailure


def create_app(settings=None, service=None):
    settings = settings or Settings()
    app = FastAPI(title='Chiro Revenue Retention', version='0.1.0')
    app.add_middleware(CORSMiddleware,allow_origins=settings.cors_origins,allow_methods=['GET','POST'],allow_headers=['Content-Type'])
    app.state.service = service
    initialization_lock=Lock()
    def construct_service():
        if app.state.service is None:
            sql = DatabricksSQL(settings)
            if settings.persistence_mode == 'delta':
                ledger = DeltaLedger(sql)
            elif settings.persistence_mode == 'local_test':
                ledger = Ledger(settings.ledger_path)
            else:
                raise ValueError('CHIRO_PERSISTENCE_MODE must be delta or local_test')
            service = RetentionService(DataTools(sql),ledger)
            if settings.agent_mode == 'llm':
                service.agent = RevenueRescueAgent(service.tools,service,DatabricksModel(sql,settings.model_endpoint),settings.model_endpoint)
            elif settings.agent_mode != 'deterministic':
                raise ValueError('CHIRO_AGENT_MODE must be llm or deterministic')
            app.state.service = service
        return app.state.service
    def get_service():
        with initialization_lock:
            return construct_service()
    @app.exception_handler(DeadlineExceeded)
    def deadline_error(request:Request,exc):
        return JSONResponse(status_code=504,content={'detail':str(exc)})
    @app.exception_handler(KeyError)
    def missing(request:Request,exc):
        return JSONResponse(status_code=404,content={'detail':'Patient or action not found'})
    @app.exception_handler(Conflict)
    def conflict(request:Request,exc):
        return JSONResponse(status_code=409,content={'detail':str(exc)})
    @app.exception_handler(DataUnavailable)
    def unavailable(request:Request,exc):
        return JSONResponse(status_code=503,content={'detail':str(exc)})
    @app.exception_handler(DatabricksError)
    def databricks_error(request:Request,exc):
        return JSONResponse(status_code=503,content={'detail':'Databricks request failed; check backend credentials, warehouse, and permissions'})
    @app.exception_handler(AgentFailure)
    def agent_failed(request:Request,exc):
        return JSONResponse(status_code=502,content={'detail':str(exc)})
    @app.exception_handler(ValidationError)
    def invalid_arguments(request:Request,exc):
        return JSONResponse(status_code=422,content={'detail':'Invalid patient ID or tool result schema'})
    @app.get('/health')
    def health(check_databricks:bool=False):
        # Liveness is separate from readiness; no false claim of connectivity.
        mode = ('llm' if service.agent else 'deterministic') if service is not None else settings.agent_mode
        result={'status':'ok','databricks':'not_checked','orchestration_mode':mode,'mlflow':'not_configured'}
        if check_databricks:
            DatabricksSQL(settings).query('SELECT 1 AS ok')
            result['databricks']='connected'
        return result
    @app.get('/api/cases',response_model=CasesResponse)
    def cases():
        return {'cases':get_service().cases()}
    @app.get('/api/cases/{patient_id}',response_model=Case)
    def case(patient_id:str):
        return get_service().get(patient_id)
    @app.get('/api/summary')
    def summary():
        return get_service().summary()
    @app.post('/api/agent/run',response_model=RunResponse)
    def run(body:RunRequest):
        # Route before service construction, warehouse access, or model inference.
        if body.message is not None and not in_scope(body.message):
            return JSONResponse(status_code=403,content={'success':False,'message':REFUSAL,
                'scope':'OUT_OF_SCOPE','tool_calls':0,'action_writes':0,'outcome_writes':0,'model_calls':0})
        if body.patient_id is None:
            match = re.search(r'\bPT[0-9]{1,12}\b',body.message or '',re.I)
            if match:
                body.patient_id = match.group().upper()
            else:
                return JSONResponse(status_code=200,content={'success':True,'scope':'IN_SCOPE',
                    'message':'Please provide patient_id to investigate a case or review its recorded decision.'})
        if body.message and re.search(r'\b(why|explain|previous|already|decision|chose|choose)\b',body.message,re.I):
            return {'case':get_service().get(body.patient_id)}
        with request_deadline(75):
            return {'case':get_service().run(body.patient_id)}
    @app.post('/api/cases/{case_id}/run',response_model=RunResponse)
    def run_case(case_id:str):
        with request_deadline(75):
            return {'case':get_service().run(case_id)}
    @app.post('/api/cases/{case_id}/approve',response_model=RunResponse)
    def approve_case(case_id:str):
        return {'case':get_service().approval(case_id)}
    @app.post('/api/cases/{case_id}/reject',response_model=RunResponse)
    def reject_case(case_id:str):
        return {'case':get_service().approval(case_id,False)}
    @app.post('/api/actions/{action_id}/approve',response_model=RunResponse)
    def approve_action(action_id:str):
        return {'case':get_service().approval(action_id,by_action=True)}
    return app

app = create_app()
