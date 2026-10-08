"""Fail-closed routing, before model inference or business tools.

This bounded rule classifier routes operational requests; it never answers from
model general knowledge. Unrecognized topics require an explicit business context.
"""
import re

REFUSAL = "Sorry, I can't help with that. I can help you investigate chiropractic business performance, patient retention, revenue risk, and patient cases."
# Explicit unrelated/clinical intents take precedence over business keywords,
# including mixed prompts and attempts to override the routing policy.
DENY = re.compile(
    r'\b(super\s*bowl|sports? scores?|poem|poetry|capital of|homework|weather|'
    r'apple stock|stock price|stock market|recipe|joke|song|story|politics|'
    r'ignore (?:all |previous |the )?instructions|bypass|system prompt|'
    r'medical advice|clinical advice|medical diagnosis|diagnose my|'
    r'treat my|treat (?:a |my |the )?(?:pain|back|neck)|'
    r'treatment recommendation|recommend (?:a |my )?(?:treatment|spinal|adjustment|exercise)|'
    r'should (?:I|the patient|a patient) (?:take|get|receive|do)|'
    r'how (?:do I|to) treat|relieve (?:my |the )?pain|'
    r'what (?:medication|medicine)|prescri\w*|symptoms?|dosage)\b',re.I)
ALLOW = re.compile(
    r'\b(PT[0-9]{1,12}|chiropractic|clinic|patient|patients|retention|'
    r'appointments?|visits?|cancellations?|no[- ]shows?|scheduling|'
    r'providers?|locations?|revenue|interventions?|recovery|'
    r'agent|outreach|reengagement|reengaged|synthetic (?:data|dataset)|'
    r'operational (?:performance|patterns?|decision)|'
    r'(?:previous|that|this) (?:case|decision|action)|'
    r'approval|discount)\b',re.I)

def in_scope(message: str) -> bool:
    return bool(message.strip() and not DENY.search(message) and ALLOW.search(message))
