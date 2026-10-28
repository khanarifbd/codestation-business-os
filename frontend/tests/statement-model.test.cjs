const test=require('node:test'),assert=require('node:assert/strict');
const {sourceLoader}=require('./reconciliation-harness.cjs'),m=sourceLoader().load('src/components/accounting-statements/statement-model.ts'),f=require('./statement-fixtures.cjs');
test('actual read DTOs validate without write-only metadata',()=>{assert.ok(m.isFinancialStatements(f.report));assert.ok(m.isStatementAccounts([f.account,f.accountB]));assert.ok(m.isStatementLedger(f.ledger));});
for(const v of [null,undefined,'',true,{},'1.001',' 1.00 ','NaN',NaN,Infinity,9007199254740992,'+1'])test(`exact read cents rejects ${String(v)}`,()=>assert.equal(m.statementScaled(v),null));
for(const [v,n]of [['0',0n],['-0.01',-1n],['12.34000',1234n],['99999999999999999.99',9999999999999999999n],[-0.5,-50n]])test(`exact signed monetary value ${v}`,()=>assert.equal(m.statementScaled(v),n));
test('formatting preserves huge cents without floating point sum',()=>assert.equal(m.statementMoney('99999999999999999.99','USD').replace(/[^0-9.]/g,''),'99999999999999999.99'));
test('unknown amounts do not become zero',()=>{assert.equal(m.statementMoney(null,'USD'),'—');assert.equal(m.statementMoney('10','bad'),'—');});
for(const v of ['2026-02-30','0000-01-01','2026-13-01','2026-1-01','garbage'])test(`invalid date ${v}`,()=>assert.equal(m.statementDate(v),false));
for(const v of ['2024-02-29','2026-01-01','9999-12-31'])test(`valid date ${v}`,()=>assert.equal(m.statementDate(v),true));
for(const key of ['total_income','total_expenses','net_profit','total_assets','total_liabilities','recorded_equity','current_earnings','total_equity','total_liabilities_and_equity'])test(`malformed aggregate ${key} is not zero`,()=>assert.equal(m.isFinancialStatements({...f.report,[key]:null}),false));
for(const key of ['income','expenses','assets','liabilities','equity'])test(`malformed row list ${key}`,()=>assert.equal(m.isFinancialStatements({...f.report,[key]:{items:[]}}),false));
for(const key of ['total_income','total_expenses','net_profit','total_assets','total_liabilities','recorded_equity','total_equity','total_liabilities_and_equity'])test(`inconsistent returned arithmetic ${key} rejected`,()=>assert.equal(m.isFinancialStatements({...f.report,[key]:'1.01'}),false));
test('display equation difference accepted and not labeled accounting proof',()=>{const x={...f.report,assets:[f.row('1000','Rounded asset','1000.01')],total_assets:'1000.01'};assert.ok(m.isFinancialStatements(x));assert.equal(m.statementDifference(x),'0.01');});
test('converted independent earnings may differ from selected period profit',()=>assert.ok(m.isFinancialStatements({...f.report,current_earnings:'310.00',total_equity:'810.00',total_liabilities_and_equity:'1010.00'})));
test('negative income/expense/cash values remain signed',()=>assert.ok(m.isFinancialStatements({...f.report,income:[f.row('4000','Reversal','-10.00')],total_income:'-10.00',net_profit:'-110.00'})));
for(const patch of [{date_from:'2025-12-31'},{date_to:'2026-02-30'},{functional_period_end:'2026-10-25'},{date_from:'2026-10-27'},{base_currency:'US'},{reporting_rate:'0'},{reporting_rate:'1.000000001'},{reporting_note:{}},{cash_flow:{...f.report.cash_flow,net_change:'91'}}])test(`invalid statement context ${JSON.stringify(patch)}`,()=>assert.equal(m.isFinancialStatements({...f.report,...patch}),false));
test('report identity accepts explicit normalized and server-default bounds',()=>{assert.ok(m.statementMatchesPeriod(f.report,'2026-10-26','2026-10-01'));assert.ok(m.statementMatchesPeriod(f.report,'','2026-10-26'));assert.ok(m.statementMatchesPeriod(f.report,'',''));assert.equal(m.statementMatchesPeriod(f.report,'2026-09-01','2026-09-30'),false);});
test('accounts are uncapped, inactive preserved, duplicate IDs fail',()=>{assert.ok(m.isStatementAccounts(Array.from({length:1200},(_,i)=>({...f.account,id:`account-${i}`}))));assert.ok(m.isStatementAccounts([{...f.account,is_active:false}]));assert.equal(m.isStatementAccounts([f.account,f.account]),false);});
test('movement identities, currency and amount shape are strict',()=>{assert.equal(m.isStatementLedger({...f.ledger,items:[f.movement,f.movement]}),false);assert.equal(m.isStatementLedger({...f.ledger,next_cursor:''}),false);assert.equal(m.isStatementLedger({...f.ledger,items:[{...f.movement,amount:'-1'}]}),false);assert.equal(m.isStatementLedger({...f.ledger,items:Array.from({length:101},(_,i)=>({...f.movement,id:`m-${i}`}))}),false);});
test('credit-card directions preserve liability meaning',()=>{assert.equal(m.movementMeaning({...f.account,account_type:'credit_card'},'credit'),'Charge / increase owed');assert.equal(m.movementMeaning({...f.account,account_type:'credit_card'},'debit'),'Payment / decrease owed');assert.equal(m.movementMeaning(f.account,'credit'),'Money in');});

for(const patch of [{reporting_rate:null},{base_currency:'EUR'},{reporting_rate_applied:false},{reporting_rate_applied:false,reporting_rate:null,base_currency:'EUR'}])test(`invalid display/accounting conversion context ${JSON.stringify(patch)}`,()=>assert.equal(m.isFinancialStatements({...f.report,...patch}),false));
test('missing FX pair explicitly stays in accounting currency',()=>assert.ok(m.isFinancialStatements({...f.report,reporting_currency:'BDT',reporting_rate_applied:false,reporting_rate:null,reporting_note:'Synthetic no pair; USD shown'})));
test('current configured conversion displays returned reporting currency',()=>assert.ok(m.isFinancialStatements({...f.report,base_currency:'BDT',reporting_currency:'BDT',reporting_rate:'110.12345678'})));

// Captured from the actual backend Pydantic DTO with all network/DB/env-file reads blocked.
const dtoFixtures=require('./statement-dto-fixtures.json');
for(const [name,data]of Object.entries(dtoFixtures.cases))test(`actual serialized backend DTO validates: ${name}`,()=>assert.ok(m.isFinancialStatements(data)));
test('actual DTO fixture pins tiny and trailing-zero exponent serialization',()=>{assert.equal(dtoFixtures.cases.tiny_fx.reporting_rate,'1E-8');assert.equal(dtoFixtures.cases.trailing_zero_fx.reporting_rate,'1.0E-7');assert.equal(dtoFixtures.provenance.synthetic,true);});
for(const [value,digits,expected]of [
 ['1E-8',8,1n],['1.0E-7',8,10n],['1.000E-8',8,1n],['100E-10',8,1n],
 ['-1E-8',8,-1n],['0E-8',2,0n],['-0.00E+90',2,0n],['1e3',2,100000n],
 ['1E+3',2,100000n],['1e-2',2,1n],['100e-4',2,1n],['1.2300E2',2,12300n],
 ['99999999999999999.99E0',2,9999999999999999999n],[1e-8,8,1n],
 ['1E89',2,10n**91n],['-1E89',2,-(10n**91n)],
])test(`bounded exact exponent ${value} at ${digits} places`,()=>assert.equal(m.statementScaled(value,digits),expected));
for(const value of ['1E-9','1.1E-8','1.000000001','1E91','1E90','0E91','1E-91','1E9999','0E-9999','1E+','1e','1e 2','1E1.0','1E--1','+1E-8','NaN','Infinity','1'.repeat(91),'1.'+'0'.repeat(89)])test(`unsafe or inexact exponent fails closed: ${value.slice(0,30)}`,()=>assert.equal(m.statementScaled(value,8),null));
for(const digits of [-1,9,1.5,NaN,Infinity])test(`invalid scale rejected: ${digits}`,()=>assert.equal(m.statementScaled('1E0',digits),null));
test('cent normalization never rounds sub-cent exponent amounts',()=>{assert.equal(m.statementScaled('1.01E-2'),null);assert.equal(m.statementScaled('1E-8'),null);});
test('huge accepted exponent money remains supported by shared exact formatter',()=>{const digits='1'+'0'.repeat(89)+'.00';assert.equal(m.statementMoney('1E89','USD').replace(/[^0-9.]/g,''),digits);assert.equal(m.statementMoney('-1E89','USD').replace(/[^0-9.-]/g,''),'-'+digits);});
test('positive reporting exponent still respects exact precision and display context',()=>{assert.equal(m.isFinancialStatements({...dtoFixtures.cases.tiny_fx,reporting_rate:'1.1E-8'}),false);assert.equal(m.isFinancialStatements({...dtoFixtures.cases.tiny_fx,reporting_rate:'0E-8'}),false);assert.equal(m.isFinancialStatements({...dtoFixtures.cases.tiny_fx,reporting_rate:'-1E-8'}),false);});
