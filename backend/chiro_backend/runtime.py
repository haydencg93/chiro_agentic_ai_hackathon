"""One deadline and centralized process-wide inference admission."""
from contextlib import contextmanager
from contextvars import ContextVar
from threading import Lock
import time

class DeadlineExceeded(RuntimeError):
    pass

_DEADLINE=ContextVar('request_deadline',default=None)

def remaining(default=75):
    end=_DEADLINE.get()
    value=default if end is None else end-time.monotonic()
    if value<=0:
        raise DeadlineExceeded('75-second whole-request deadline exceeded; retry retrieves or resumes any recorded action')
    return value

@contextmanager
def request_deadline(seconds=75):
    if _DEADLINE.get() is not None:
        remaining()
        yield
        return
    token=_DEADLINE.set(time.monotonic()+seconds)
    try:
        yield
        remaining()
    finally:
        _DEADLINE.reset(token)

class ModelPacer:
    def __init__(self,interval=5,clock=time.monotonic,sleep=time.sleep):
        self.interval,self.clock,self.sleep=interval,clock,sleep
        self.lock=Lock()
        self.last_start=None
        self.cooldown_until=0
    def admit(self,budget):
        with self.lock:
            now=self.clock()
            next_start=max(self.cooldown_until,(self.last_start+self.interval) if self.last_start is not None else now)
            wait=max(0,next_start-now)
            if wait>=budget:
                raise DeadlineExceeded('Model pacing/retry wait exceeds whole-request deadline')
            if wait:
                self.sleep(wait)
            self.last_start=self.clock()
    def cooldown(self,delay):
        with self.lock:
            self.cooldown_until=max(self.cooldown_until,self.clock()+delay)

MODEL_PACER=ModelPacer()
ACTIVE_RUN=Lock()
