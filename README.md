# chiro_agentic_ai_hackathon

## What specific business problem are we solving?

Chiropractic businesses can lose significant recurring revenue when existing patients begin disengaging from care, but the best intervention is not the same for every patient. A patient may be disengaging because of scheduling friction, declining visit frequency, repeated cancellations, poor fit with their current plan, or another operational issue.

Clinics often respond with generic reminders, staff outreach, or discounts without knowing which intervention will actually provide the best business outcome. This can lead to lost patients, unnecessary discounts, and staff time spent on low-value interventions.

Our project, **NAME TBD**, addresses this problem with an agentic AI system that identifies revenue at risk, investigates why a patient is disengaging, evaluates multiple possible interventions, and selects the action with the highest expected retained value.

Rather than simply predicting which patients are at risk, the agent determines **what the business should do next**.

## Who experiences this problem?

This problem affects several groups within a chiropractic business:

- Clinic managers who need to maintain patient engagement and revenue.
- Front-desk and scheduling staff who are responsible for patient outreach.
- Revenue and operations teams that need to understand where preventable revenue is being lost.
- Leadership teams trying to grow the organization while maintaining strong retention and profit margins.

As the number of patients and locations grows, manually investigating every potentially disengaged patient becomes increasingly difficult.

## What data would help us understand it?

We will primarily use the synthetic data provided in the Databricks `workspace.chiro_hackathon` schema.

Relevant tables include:

- `patients` for patient-level business information
- `appointments` for appointment history, cancellations, no-shows, timing, providers, and locations
- `visits` for completed visits and associated revenue
- `providers` for provider information
- `locations` for clinic-level context

The agent can combine these tables to identify patterns such as:

- declining visit frequency
- repeated cancellations or no-shows
- unusually long gaps between visits
- lack of future appointments
- changes in appointment behavior
- estimated revenue associated with continued engagement

We may also create small synthetic tables for available interventions, agent decisions, and simulated outcomes so that the system can compare actions and measure results.

## What decision does the business need to make?

The core business decision is:

**For a patient whose future revenue appears to be at risk, what intervention should the clinic take next?**

The correct answer may differ by patient.

Possible decisions could include:

- take no action
- provide scheduling assistance
- initiate staff outreach
- provide additional value or care-plan education
- recommend a different plan or package
- escalate the case for human review
- offer a limited financial incentive when justified

The goal is not simply to maximize retention at any cost. The agent should select the intervention that provides the strongest expected business outcome while considering both retained revenue and the cost of the intervention.

## What can an agent do automatically?

The Revenue Rescue agent can autonomously coordinate multiple steps that would otherwise require a person to investigate several datasets manually.

The agent may:

1. Identify patients showing potential disengagement or revenue-risk signals.
2. Query appointment and visit history.
3. Calculate estimated revenue at risk.
4. Compare the patient's behavior with relevant historical patterns.
5. Investigate possible reasons for disengagement.
6. Retrieve the available intervention options.
7. Evaluate or simulate the expected result of each intervention.
8. Select the intervention with the strongest expected net value.
9. Record its reasoning and decision.
10. Initiate low-risk actions or route higher-impact decisions for human approval.
11. Track the resulting simulated business outcome.

This creates a complete agentic workflow rather than a static dashboard or a chatbot answering questions about the data.

## What action should the agent recommend or initiate?

The agent should recommend the specific intervention that best addresses the issue it discovers.

For example, if a patient has recently cancelled multiple appointments but historically attended consistently, the agent may determine that the primary issue is scheduling friction. It could compare several interventions and determine that offering alternative appointment times has a higher expected value than providing a discount.

For low-risk actions, the agent could automatically create an outreach or scheduling task and record it in Databricks.

For higher-impact actions, such as discounts or pricing changes, the agent can create a recommendation for manager approval rather than executing the action automatically.

Each recommendation should include:

- the detected problem
- supporting evidence
- estimated revenue at risk
- interventions considered
- selected intervention
- expected recovery
- estimated intervention cost
- reasoning for the final decision

## How will we measure success?

We will measure both the quality of the agent's decisions and the resulting business impact.

Potential metrics include:

- total revenue identified as at risk
- estimated revenue recoverable
- simulated revenue actually recovered
- percentage of at-risk patients successfully re-engaged
- intervention success rate
- revenue recovered per intervention
- unnecessary discounts avoided
- cost of intervention compared with revenue retained
- percentage of cases handled automatically
- percentage of cases escalated for human approval

For the prototype, synthetic outcomes can be used to demonstrate the full **Observe → Reason → Decide → Act → Measure** workflow.

The main business metric will be **net retained revenue**, rather than simply the number of patients contacted.

## How could this scale across locations/customers to contribute to the $250M ARR goal?

The value of Revenue Rescue increases as the organization grows.

At a small clinic, staff may be able to recognize disengagement manually. At a business operating many locations and serving tens or hundreds of thousands of patients, manually investigating every case becomes unrealistic.

Revenue Rescue can continuously analyze patient activity across all locations, prioritize the cases with the greatest financial impact, and recommend or initiate interventions without requiring staff to manually inspect every patient record.

Even relatively small improvements become meaningful at scale. At $250M ARR, preventing only **1% of otherwise avoidable revenue loss represents $2.5M in annual revenue**.

The same agent architecture could also eventually be extended to other business decisions, including lead intervention and pricing optimization. However, the hackathon prototype will intentionally focus on one high-quality workflow: identifying preventable revenue loss and determining the best action to recover it.
