import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { getCase, runCase } = vi.hoisted(() => ({ getCase: vi.fn(), runCase: vi.fn() }));
vi.mock('../src/api/agentApi.js', () => ({ agentApi: { getCase, runCase } }));
import CasePage from '../src/pages/CasePage.jsx';
const ready = { case_id:'CASE-PT1',patient:{patient_id:'PT1',age_band:'25-34',home_location_id:'LOC007',acquisition_source:'Referral Program',first_visit_date:'2022-11-24',tenure_months:46},status:'READY',risk:{level:'HIGH',revenue_at_risk:100},as_of_date:'2026-10-01',signals:[{type:'LAST_VISIT',label:'Visit gap',value:'110'}],trace:[],interventions:[],diagnosis:null,action:null,outcome:null };
const completed = { ...ready, status:'ACTIONED',agent_run:{status:'COMPLETED'},diagnosis:{label:'Scheduling Friction',confidence:.8,explanation:'Observed cancelled appointment.',evidence:[{evidence_id:'E1',field:'cancelled_appointments',value:1,tool:'snapshot'}]},interventions:[{intervention_id:'SCHEDULING_ASSISTANCE',name:'Scheduling Assistance',selected:true,expected_recovery:45,estimated_cost:8,net_value:37,recovery_probability:.45}],action:{status:'EXECUTED',assignee:'Scheduling Team',priority:'HIGH',requires_approval:false},outcome:{simulated_expected_recovery:45,simulated_expected_net_value:37,observed_revenue_recovered:0},trace:['OBSERVE','INVESTIGATE','DIAGNOSE','SIMULATE','DECIDE','ACT','MEASURE'].map((stage,i)=>({id:String(i),stage,status:'COMPLETED',title:stage,summary:'Recorded fact'})) };
const show = () => render(<MemoryRouter initialEntries={['/cases/CASE-PT1']}><Routes><Route path='/cases/:caseId' element={<CasePage />} /></Routes></MemoryRouter>);
describe('case polish',()=>{
 beforeEach(()=>{getCase.mockReset();runCase.mockReset()});
 it('keeps an unanalysed case quiet and the analyze button connected',async()=>{
  getCase.mockResolvedValue(ready);runCase.mockResolvedValue({case:completed});show();
  await screen.findByText('Needs Analysis');
  expect(screen.getByText('Age band 25-34')).toBeInTheDocument();
  expect(screen.getByText('Location LOC007')).toBeInTheDocument();
  expect(screen.getByText('Referral Program')).toBeInTheDocument();
  expect(screen.getByText('First visit 2022-11-24')).toBeInTheDocument();
  expect(screen.getByText('Tenure 46 months')).toBeInTheDocument();
  expect(screen.queryByText('Patient Record')).not.toBeInTheDocument();
  const header = screen.getByRole('heading', {name:'PT1'}).closest('section');
  expect(within(header).queryByText(/Visit gap/)).not.toBeInTheDocument();
  expect(screen.getAllByText('Not analyzed yet')).toHaveLength(3);
  expect(screen.queryByText('Scheduling Friction')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button',{name:'Analyze Case'}));
  expect(runCase).toHaveBeenCalledExactlyOnceWith('CASE-PT1');
  await waitFor(()=>expect(screen.getByRole('button',{name:'Refresh Case'})).toBeInTheDocument(),{timeout:7000});
  expect(screen.getByRole('heading',{name:'What the agent found'})).toBeInTheDocument();
  expect(screen.getAllByText('Action Recorded').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Not observed').length).toBeGreaterThan(0);
 },10000);
 it('keeps pending summary compact without fabricated results',async()=>{
  getCase.mockResolvedValue(ready);runCase.mockReturnValue(new Promise(()=>{}));show();
  await screen.findByRole('button',{name:'Analyze Case'});
  await userEvent.click(screen.getByRole('button',{name:'Analyze Case'}));
  expect(screen.getAllByText('Analyzing…')).toHaveLength(4);
  expect(screen.queryByText('Scheduling Friction')).not.toBeInTheDocument();
  for (const label of ['What the agent found', 'Recommended action']) {
    const card = screen.getByRole('heading', {name:label}).closest('.surface-card');
    expect(within(card).queryByText('—')).not.toBeInTheDocument();
  }
  expect(document.querySelectorAll('article')).toHaveLength(7);
 });
 it('loads completed economics and refreshes without another analysis',async()=>{
  getCase.mockResolvedValue(completed);show();
  await screen.findByRole('button',{name:'Refresh Case'});
  expect(screen.getAllByText('$45.00').length).toBeGreaterThan(0);
  expect(screen.getAllByText('$37.00').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Observed Recovery').length).toBeGreaterThan(0);
  expect(document.querySelectorAll('article')).toHaveLength(7);
  await userEvent.click(screen.getByRole('button',{name:'Refresh Case'}));
  await waitFor(()=>expect(getCase).toHaveBeenCalledTimes(2));
  expect(runCase).not.toHaveBeenCalled();
 });
});
