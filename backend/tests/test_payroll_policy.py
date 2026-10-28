"""Pure synthetic payroll-policy contract tests. No DB/config/network/GPS imports."""
import json
from datetime import date
from decimal import Decimal as D
import unittest

from pydantic import ValidationError
from app.schemas.payroll_policy import PayrollCalculationInput, PayrollPolicyConfig
from app.services.payroll_policy import PayrollCalculationError, calculate_payroll, reference_cycle_bounds, payroll_reference_horizon


def fixture(mode="calendar_day", **changes):
    value = {
        "organization_id": "synthetic-org", "timezone": "Asia/Dhaka", "period_id": "synthetic-period", "period_start": "2026-11-01", "period_end": "2026-11-30", "currency": "USD",
        "policy": {"id": "synthetic-policy", "version": 1, "effective_from": "2020-01-01", "config": {"mode": mode}},
        "employees": [{"id": "employee", "organization_id": "synthetic-org", "employment_status": "active", "join_date": "2020-01-01", "end_date": None}],
        "profiles": [{"id": "profile", "organization_id": "synthetic-org", "employee_id": "employee", "currency": "USD", "pay_frequency": "monthly", "base_salary": "1000.00", "default_allowances": [], "default_deductions": [], "effective_from": "2020-01-01", "effective_to": None, "is_active": True}], "holidays": [],
    }
    if mode == "working_day":
        value["policy"]["config"].update(working_weekdays=[0,1,2,3,4], holiday_treatment="count_scheduled")
    value.update(changes)
    return value


def profile(source, **changes):
    return {**source, **changes}


def holiday(day, ident="holiday", **changes):
    return {"id": ident, "organization_id": "synthetic-org", "holiday_date": day, "name": "Synthetic holiday", "is_paid": True, **changes}


def run(value):
    return calculate_payroll(PayrollCalculationInput.model_validate(value))


class PayrollPolicyTests(unittest.TestCase):
    def issue(self, value, code):
        with self.assertRaises(PayrollCalculationError) as error:
            run(value)
        self.assertIn(code, [issue.code for issue in error.exception.issues])
        return error.exception

    def test_legacy_half_month_exact_original_amounts(self):
        value=fixture(policy=None,period_start="2026-11-16")
        value["employees"][0].update(join_date=None,employment_status="suspended")
        value["profiles"][0].update(effective_from="2026-11-16",default_allowances=[{"name":"Housing","amount":"125.50"}],default_deductions=[{"name":"Fund","amount":"25.25"}])
        result=run(value)
        self.assertEqual((result.entries[0].base_salary,result.gross_total,result.net_total),(D("1000"),D("1125.50"),D("1100.25")))
        self.assertEqual(result.engine_version,"payroll-legacy-v0")
        self.assertEqual(result.policy_version,0)

    def test_explicit_manual_v1_matches_legacy_amounts_not_automatic_dates(self):
        value=fixture("manual",period_start="2026-11-16")
        value["employees"][0].update(join_date=None,employment_status="suspended")
        self.assertEqual(run(value).net_total,run({**value,"policy":None}).net_total)
        self.assertEqual(run(value).engine_version,"payroll-policy-v1")

    def test_manual_currency_first_latest_overlap(self):
        value=fixture("manual")
        old=value["profiles"][0]
        value["profiles"]=[profile(old,id="old",is_active=False,effective_to="2026-11-15"),profile(old,id="latest",base_salary="2000",effective_from="2026-11-16"),profile(old,id="other-currency",currency="BDT",base_salary="50000",effective_from="2026-11-20")]
        result=run(value)
        self.assertEqual(result.net_total,D("2000"))
        self.assertEqual(result.entries[0].salary_profile_id,"latest")

    def test_legacy_inactive_unbounded_profile_excluded(self):
        value=fixture(policy=None)
        value["profiles"][0]["is_active"]=False
        self.issue(value,"NO_ELIGIBLE_PROFILES")

    def test_legacy_historical_closed_inactive_profile_included(self):
        value=fixture(policy=None)
        value["profiles"][0].update(is_active=False,effective_to="2026-11-01")
        self.assertEqual(run(value).net_total,D("1000"))

    def test_legacy_profile_start_after_period_excluded(self):
        value=fixture(policy=None)
        value["profiles"][0]["effective_from"]="2026-12-01"
        self.issue(value,"NO_ELIGIBLE_PROFILES")

    def test_legacy_profile_ending_before_period_excluded(self):
        value=fixture(policy=None)
        value["profiles"][0]["effective_to"]="2026-10-31"
        self.issue(value,"NO_ELIGIBLE_PROFILES")

    def test_calendar_partial_period_full_month_denominator(self):
        result=run(fixture(period_start="2026-11-16"))
        self.assertEqual(result.net_total,D("500"))
        item=json.loads(result.entries[0].calculation_snapshot_json)["slices"][0]
        self.assertEqual((item["numerator"],item["denominator"]),(15,30))

    def test_join_date_inclusive(self):
        value=fixture();value["employees"][0]["join_date"]="2026-11-16"
        self.assertEqual(run(value).net_total,D("500"))

    def test_active_null_end_open_ended_not_missing(self):
        self.assertEqual(run(fixture()).net_total,D("1000"))

    def test_historical_terminated_employee_paid_through_inclusive_end(self):
        value=fixture();value["employees"][0].update(employment_status="terminated",end_date="2026-11-15")
        self.assertEqual(run(value).net_total,D("500"))

    def test_ended_employee_missing_end_blocks(self):
        value=fixture();value["employees"][0]["employment_status"]="terminated"
        self.issue(value,"EMPLOYMENT_END_REQUIRED")

    def test_suspended_open_ended_employee_not_guessed_active(self):
        value=fixture();value["employees"][0]["employment_status"]="suspended"
        self.issue(value,"EMPLOYMENT_END_REQUIRED")

    def test_missing_join_named_setup_error(self):
        value=fixture();value["employees"][0]["join_date"]=None
        error=self.issue(value,"EMPLOYMENT_START_REQUIRED")
        self.assertEqual(error.issues[0].employee_id,"employee")

    def test_outside_employment_interval_no_payable_entries(self):
        value=fixture();value["employees"][0].update(employment_status="terminated",join_date=None,end_date="2026-10-31")
        self.issue(value,"NO_ELIGIBLE_PROFILES")

    def test_future_employee_not_paid_before_join(self):
        value=fixture();value["employees"][0]["join_date"]="2026-12-01"
        self.issue(value,"NO_ELIGIBLE_PROFILES")

    def test_entire_missing_profile_coverage_is_error_not_empty_roster(self):
        value=fixture(profiles=[])
        self.issue(value,"PROFILE_GAP")

    def test_profile_mid_period_start_exposes_initial_gap(self):
        value=fixture();value["profiles"][0]["effective_from"]="2026-11-16"
        self.issue(value,"PROFILE_GAP")

    def test_profile_end_exposes_trailing_gap(self):
        value=fixture();value["profiles"][0]["effective_to"]="2026-11-15"
        self.issue(value,"PROFILE_GAP")

    def test_middle_profile_gap_blocks(self):
        value=fixture();p=value["profiles"][0]
        value["profiles"]=[profile(p,effective_to="2026-11-14"),profile(p,id="new",effective_from="2026-11-16")]
        self.issue(value,"PROFILE_GAP")

    def test_overlapping_profiles_block_across_currencies(self):
        value=fixture();p=value["profiles"][0]
        value["profiles"]=[p,profile(p,id="other",currency="BDT",effective_from="2026-11-16")]
        self.issue(value,"PROFILE_OVERLAP")

    def test_same_day_old_end_new_start_is_overlap(self):
        value=fixture();p=value["profiles"][0]
        value["profiles"]=[profile(p,effective_to="2026-11-16"),profile(p,id="new",effective_from="2026-11-16")]
        self.issue(value,"PROFILE_OVERLAP")

    def test_adjacent_profile_rate_change_splits(self):
        value=fixture();p=value["profiles"][0]
        value["profiles"]=[profile(p,effective_to="2026-11-15",is_active=False),profile(p,id="new",effective_from="2026-11-16",base_salary="2000")]
        result=run(value)
        self.assertEqual(result.net_total,D("1500"))
        self.assertEqual(set(result.entries[0].profile_ids),{"profile","new"})
        self.assertEqual(result.entries[0].salary_profile_id,"new")

    def test_inactive_unbounded_profile_is_named_automatic_error(self):
        value=fixture();value["profiles"][0]["is_active"]=False
        self.issue(value,"INACTIVE_OPEN_PROFILE")

    def test_currency_change_native_segments_not_mixed_or_gap(self):
        value=fixture();p=value["profiles"][0]
        value["profiles"]=[profile(p,effective_to="2026-11-15"),profile(p,id="bdt",effective_from="2026-11-16",currency="BDT",base_salary="20000")]
        usd=run(value);bdt=run({**value,"currency":"BDT"})
        self.assertEqual((usd.net_total,bdt.net_total),(D("500"),D("10000")))
        self.assertEqual((usd.currency,bdt.currency),("USD","BDT"))
        self.assertEqual(usd.entries[0].profile_ids,("profile",))

    def test_calendar_spanning_months_uses_each_month(self):
        value=fixture(period_start="2026-10-16",period_end="2026-11-15")
        self.assertEqual(run(value).net_total,D("1016.13"))

    def test_calendar_leap_month_full_pay(self):
        result=run(fixture(period_start="2028-02-01",period_end="2028-02-29"))
        self.assertEqual(result.net_total,D("1000"))
        self.assertEqual(json.loads(result.entries[0].calculation_snapshot_json)["slices"][0]["denominator"],29)

    def test_calendar_full_multiple_months_pay_multiple_cycles(self):
        self.assertEqual(run(fixture(period_start="2026-10-01",period_end="2026-11-30")).net_total,D("2000"))

    def test_working_full_cycle_not_partial_interval_denominator(self):
        value=fixture("working_day",period_start="2026-11-16")
        value["policy"]["config"]["working_weekdays"]=[0]
        self.assertEqual(run(value).net_total,D("600"))

    def test_holiday_outside_partial_period_changes_full_denominator(self):
        value=fixture("working_day",period_start="2026-11-16",holidays=[holiday("2026-11-02")])
        value["policy"]["config"].update(working_weekdays=[0],holiday_treatment="exclude")
        self.assertEqual(run(value).net_total,D("750"))

    def test_duplicate_holiday_dates_count_once(self):
        value=fixture("working_day",period_start="2026-11-16",holidays=[holiday("2026-11-02"),holiday("2026-11-02","other",name="Other name")])
        value["policy"]["config"].update(working_weekdays=[0],holiday_treatment="exclude")
        result=run(value)
        self.assertEqual(result.net_total,D("750"))
        self.assertEqual(json.loads(result.entries[0].calculation_snapshot_json)["holiday_dates"],["2026-11-02"])

    def test_count_holidays_choice_does_not_infer_paid_status(self):
        value=fixture("working_day",period_start="2026-11-16",holidays=[holiday("2026-11-02",is_paid=False)])
        value["policy"]["config"]["working_weekdays"]=[0]
        self.assertEqual(run(value).net_total,D("600"))

    def test_excluded_holiday_on_weekend_not_double_subtracted(self):
        value=fixture("working_day",holidays=[holiday("2026-11-01")]);value["policy"]["config"]["holiday_treatment"]="exclude"
        self.assertEqual(run(value).net_total,D("1000"))

    def test_zero_denominator_is_error(self):
        value=fixture("working_day",holidays=[holiday("2026-11-"+str(day).zfill(2),str(day)) for day in [2,9,16,23,30]])
        value["policy"]["config"].update(working_weekdays=[0],holiday_treatment="exclude")
        self.issue(value,"ZERO_DENOMINATOR")

    def test_nonworking_only_interval_preserves_fixed_components(self):
        value=fixture("working_day",period_start="2026-11-07",period_end="2026-11-08")
        value["profiles"][0].update(default_allowances=[{"name":"Fixed","amount":"125.50"}],default_deductions=[{"name":"Fixed deduction","amount":"25.25"}])
        result=run(value);entry=result.entries[0]
        self.assertEqual((entry.base_salary,entry.gross_pay,entry.net_pay),(D("0"),D("125.50"),D("100.25")))
        self.assertEqual(json.loads(entry.calculation_snapshot_json)["slices"][0]["numerator"],0)
        self.assertGreater(json.loads(entry.calculation_snapshot_json)["slices"][0]["denominator"],0)

    def test_nonworking_interval_not_silently_dropped_if_zero_money(self):
        result=run(fixture("working_day",period_start="2026-11-07",period_end="2026-11-08"))
        self.assertEqual(result.employee_count,1)
        self.assertEqual(result.net_total,D("0"))

    def test_nonworking_interval_fixed_deduction_negative_net_blocks(self):
        value=fixture("working_day",period_start="2026-11-07",period_end="2026-11-08")
        value["profiles"][0]["default_deductions"]=[{"name":"Fixed","amount":"1"}]
        self.issue(value,"NEGATIVE_NET")

    def test_nonworking_interval_prorated_components_zero(self):
        value=fixture("working_day",period_start="2026-11-07",period_end="2026-11-08")
        value["policy"]["config"].update(allowance_treatment="prorate_profile_segments",deduction_treatment="prorate_profile_segments")
        value["profiles"][0].update(default_allowances=[{"name":"Prorated","amount":"125.50"}],default_deductions=[{"name":"Prorated deduction","amount":"25.25"}])
        entry=run(value).entries[0]
        self.assertEqual((entry.base_salary,entry.allowance_total,entry.deduction_total),(D(0),D(0),D(0)))

    def test_fixed_components_from_latest_profile_once(self):
        value=fixture();p=value["profiles"][0]
        value["profiles"]=[profile(p,effective_to="2026-11-15",default_allowances=[{"name":"Old","amount":"999"}]),profile(p,id="new",effective_from="2026-11-16",default_allowances=[{"name":"New","amount":"100"}])]
        result=run(value)
        self.assertEqual(result.allowance_total,D("100"))
        self.assertEqual([row.name for row in result.entries[0].allowances],["New"])

    def test_prorated_components_follow_each_source_profile(self):
        value=fixture();p=value["profiles"][0]
        value["policy"]["config"].update(allowance_treatment="prorate_profile_segments",deduction_treatment="prorate_profile_segments")
        value["profiles"]=[profile(p,effective_to="2026-11-15",default_allowances=[{"name":"Old","amount":"100"}],default_deductions=[{"name":"D","amount":"20"}]),profile(p,id="new",effective_from="2026-11-16",default_allowances=[{"name":"New","amount":"200"}],default_deductions=[{"name":"D","amount":"40"}])]
        result=run(value)
        self.assertEqual((result.allowance_total,result.deduction_total,result.net_total),(D("150"),D("30"),D("1120")))

    def test_duplicate_component_names_retain_identity(self):
        value=fixture();value["profiles"][0]["default_allowances"]=[{"name":"Same","amount":"1"},{"name":"Same","amount":"2"}]
        rows=run(value).entries[0].allowances
        self.assertEqual([(r.name,r.source_component_index,r.amount) for r in rows],[("Same",0,D(1)),("Same",1,D(2))])

    def test_base_rounds_once_after_all_profile_slices(self):
        value=fixture();p=profile(value["profiles"][0],base_salary="0.01")
        value["profiles"]=[profile(p,effective_to="2026-11-15"),profile(p,id="new",effective_from="2026-11-16")]
        self.assertEqual(run(value).net_total,D("0.01"))

    def test_half_up_not_bankers_rounding(self):
        value=fixture(period_start="2026-11-16");value["profiles"][0]["base_salary"]="0.01"
        self.assertEqual(run(value).net_total,D("0.01"))

    def test_tax_is_zero_no_statutory_formula(self):
        result=run(fixture())
        self.assertEqual(result.tax_total,D(0));self.assertEqual(result.entries[0].tax_amount,D(0))

    def test_high_precision_large_salary_not_float(self):
        value=fixture(period_start="2026-11-16");value["profiles"][0]["base_salary"]="9999999999999999.99"
        self.assertEqual(run(value).net_total,D("5000000000000000.00"))

    def test_snapshot_is_immutable_after_source_input_edits(self):
        value=fixture();result=run(value);old=result.input_snapshot_json
        value["profiles"][0]["base_salary"]="9999"
        self.assertEqual(result.input_snapshot_json,old);self.assertEqual(result.net_total,D(1000))
        with self.assertRaises(ValidationError):result.net_total=D(1)

    def test_semantic_order_and_decimal_representation_produce_same_hash(self):
        value=fixture();value["holidays"]=[holiday("2026-11-02","a"),holiday("2026-11-03","b")]
        first=run(value)
        value["holidays"].reverse();value["profiles"][0]["base_salary"]="1000"
        self.assertEqual(run(value).calculation_hash,first.calculation_hash)

    def test_policy_calendar_change_changes_new_digest_not_previous_result(self):
        value=fixture("working_day",period_start="2026-11-16");first=run(value)
        value["policy"]["config"]["working_weekdays"]=[0]
        second=run(value)
        self.assertNotEqual(first.calculation_hash,second.calculation_hash)
        self.assertNotEqual(first.net_total,second.net_total)
        self.assertEqual(json.loads(first.input_snapshot_json)["policy"]["config"]["working_weekdays"],[0,1,2,3,4])

    def test_holiday_change_changes_new_digest(self):
        value=fixture("working_day");first=run(value)
        value["holidays"]=[holiday("2026-11-02")]
        self.assertNotEqual(first.calculation_hash,run(value).calculation_hash)

    def test_no_volatile_timestamp_in_snapshots(self):
        result=run(fixture());snapshot=json.loads(result.input_snapshot_json)
        self.assertNotIn("created_at",snapshot);self.assertNotIn("calculated_at",snapshot)
        self.assertEqual(result.calculation_hash,run(fixture()).calculation_hash)

    def test_entry_snapshot_excludes_other_employee_inputs(self):
        value=fixture();value["employees"].append({**value["employees"][0],"id":"other"});value["profiles"].append(profile(value["profiles"][0],id="other-profile",employee_id="other",base_salary="1234"))
        result=run(value);own=next(e for e in result.entries if e.employee_id=="employee")
        self.assertNotIn('"other"',own.calculation_snapshot_json);self.assertNotIn("other-profile",own.calculation_snapshot_json)
        self.assertEqual(result.net_total,D("2234"))

    def test_tenant_mismatch_blocks(self):
        value=fixture();value["profiles"][0]["organization_id"]="other-org"
        self.issue(value,"TENANT_MISMATCH")

    def test_unknown_employee_blocks(self):
        value=fixture();value["profiles"][0]["employee_id"]="unknown"
        self.issue(value,"UNKNOWN_EMPLOYEE")

    def test_policy_not_effective_at_period_start_blocks(self):
        value=fixture();value["policy"]["effective_from"]="2026-11-16"
        self.issue(value,"POLICY_NOT_EFFECTIVE")

    def test_duplicate_profile_identity_blocks(self):
        value=fixture();value["profiles"].append(value["profiles"][0].copy())
        self.issue(value,"DUPLICATE_PROFILE")

    def test_duplicate_employee_identity_blocks(self):
        value=fixture();value["employees"].append(value["employees"][0].copy())
        self.issue(value,"DUPLICATE_EMPLOYEE")

    def test_working_monthly_horizon_includes_outside_partial_period(self):
        data=PayrollCalculationInput.model_validate(fixture("working_day",period_start="2026-11-16",period_end="2026-11-20"))
        self.assertEqual(payroll_reference_horizon(data.period_start,data.period_end,data.profiles,data.policy.config),(date(2026,11,1),date(2026,11,30)))

    def test_negative_net_blocks_all_result(self):
        value=fixture();value["profiles"][0]["default_deductions"]=[{"name":"Too much","amount":"1001"}]
        self.issue(value,"NEGATIVE_NET")


def calendar_oracle_test(start,end,expected):
    def check(self):self.assertEqual(run(fixture(period_start=start,period_end=end)).net_total,D(expected))
    return check


for index,(start,end,expected) in enumerate([
    ("2026-02-01","2026-02-14","500"),("2028-02-01","2028-02-14","482.76"),
    ("2026-01-01","2026-01-15","483.87"),("2026-04-01","2026-04-15","500"),
    ("2026-11-30","2026-11-30","33.33"),("2026-12-01","2026-12-31","1000"),
    ("2026-12-16","2027-01-15","1000"),
]):setattr(PayrollPolicyTests,f"test_calendar_oracle_{index}",calendar_oracle_test(start,end,expected))


def frequency_test(frequency,anchor,day,expected_start,expected_end):
    def check(self):
        config=PayrollPolicyConfig(mode="calendar_day",**{frequency+"_anchor":anchor})
        self.assertEqual(reference_cycle_bounds(date.fromisoformat(day),frequency,config),(date.fromisoformat(expected_start),date.fromisoformat(expected_end)))
    return check


for index,row in enumerate([
    ("weekly","2026-11-02","2026-11-05","2026-11-02","2026-11-08"),
    ("weekly","2026-11-02","2026-11-01","2026-10-26","2026-11-01"),
    ("biweekly","2026-11-02","2026-11-15","2026-11-02","2026-11-15"),
    ("biweekly","2026-11-02","2026-11-01","2026-10-19","2026-11-01"),
]):setattr(PayrollPolicyTests,f"test_cycle_anchor_{index}",frequency_test(*row))


def missing_anchor_test(frequency):
    def check(self):
        value=fixture();value["profiles"][0]["pay_frequency"]=frequency
        self.issue(value,"MISSING_CYCLE_ANCHOR")
    return check


for frequency in ("weekly","biweekly"):
    setattr(PayrollPolicyTests,f"test_missing_{frequency}_anchor",missing_anchor_test(frequency))


def invalid_config_test(config):
    def check(self):
        with self.assertRaises(ValidationError):PayrollPolicyConfig.model_validate(config)
    return check


for index,config in enumerate([
    {"mode":"guess"},{"mode":"working_day"},{"mode":"working_day","working_weekdays":[0]},
    {"mode":"working_day","holiday_treatment":"exclude"},{"working_weekdays":[]},
    {"working_weekdays":[0,0]},{"working_weekdays":[7]},{"working_weekdays":[-1]},
    {"working_weekdays":[True]},{"working_weekdays":["1"]},{"working_weekdays":123},{"working_weekdays":"Mon"},{"working_weekdays":{}},{"holiday_treatment":"automatic"},
    {"allowance_treatment":"tax-law"},{"unknown":True},
]):setattr(PayrollPolicyTests,f"test_invalid_config_{index}",invalid_config_test(config))




class PayrollPolicyEdgeTests(unittest.TestCase):
    issue = PayrollPolicyTests.issue


    def test_weekly_calendar_fraction_uses_seven_day_reference(self):
        value=fixture(period_start="2026-11-05",period_end="2026-11-06")
        value["profiles"][0]["pay_frequency"]="weekly"
        value["policy"]["config"]["weekly_anchor"]="2026-11-02"
        self.assertEqual(run(value).net_total,D("285.71"))

    def test_biweekly_calendar_fraction_uses_fourteen_day_reference(self):
        value=fixture(period_start="2026-11-02",period_end="2026-11-08")
        value["profiles"][0]["pay_frequency"]="biweekly"
        value["policy"]["config"]["biweekly_anchor"]="2026-11-02"
        self.assertEqual(run(value).net_total,D("500"))

    def test_weekly_working_day_holiday_outside_period_in_denominator(self):
        value=fixture("working_day",period_start="2026-11-05",period_end="2026-11-05",holidays=[holiday("2026-11-02")])
        value["profiles"][0]["pay_frequency"]="weekly"
        value["policy"]["config"].update(weekly_anchor="2026-11-02",holiday_treatment="exclude")
        result=run(value)
        self.assertEqual(result.net_total,D("250"))
        row=json.loads(result.entries[0].calculation_snapshot_json)["slices"][0]
        self.assertEqual((row["numerator"],row["denominator"]),(1,4))

    def test_working_nonmonthly_horizon_reaches_entire_cycle(self):
        value=fixture("working_day",period_start="2026-11-05",period_end="2026-11-05")
        value["profiles"][0]["pay_frequency"]="biweekly"
        value["policy"]["config"]["biweekly_anchor"]="2026-11-02"
        data=PayrollCalculationInput.model_validate(value)
        self.assertEqual(payroll_reference_horizon(data.period_start,data.period_end,data.profiles,data.policy.config),(date(2026,11,2),date(2026,11,15)))

    def test_weekly_full_multiple_cycles(self):
        value=fixture(period_start="2026-11-02",period_end="2026-11-15")
        value["profiles"][0]["pay_frequency"]="weekly"
        value["policy"]["config"]["weekly_anchor"]="2026-11-02"
        self.assertEqual(run(value).net_total,D("2000"))

    def test_fixed_component_once_even_across_multiple_cycles(self):
        value=fixture(period_start="2026-10-01",period_end="2026-11-30")
        value["profiles"][0]["default_allowances"]=[{"name":"Once","amount":"100"}]
        result=run(value)
        self.assertEqual((result.gross_total,result.allowance_total),(D("2100"),D("100")))

    def test_prorated_component_accumulates_before_rounding_across_cycles(self):
        value=fixture(period_start="2026-11-02",period_end="2026-11-15")
        value["profiles"][0].update(pay_frequency="weekly",default_allowances=[{"name":"Cycle","amount":"0.01"}])
        value["policy"]["config"].update(weekly_anchor="2026-11-02",allowance_treatment="prorate_profile_segments")
        entry=run(value).entries[0]
        self.assertEqual(len(entry.allowances),1)
        self.assertEqual(entry.allowance_total,D("0.02"))

    def test_first_last_dates_same_employee_one_day_paid(self):
        value=fixture();value["employees"][0].update(join_date="2026-11-15",end_date="2026-11-15",employment_status="terminated")
        self.assertEqual(run(value).net_total,D("33.33"))

    def test_setup_issues_collect_across_candidates_no_partial_result(self):
        value=fixture();value["employees"][0]["join_date"]=None
        value["employees"].append({**value["employees"][0],"id":"other","join_date":"2020-01-01"})
        value["profiles"].append(profile(value["profiles"][0],id="other-profile",employee_id="other",effective_from="2026-12-01"))
        error=self.issue(value,"EMPLOYMENT_START_REQUIRED")
        self.assertEqual({issue.employee_id for issue in error.issues},{"employee","other"})
        self.assertIn("PROFILE_GAP",[issue.code for issue in error.issues])

    def test_profile_invalid_current_interval_blocks(self):
        value=fixture();value["profiles"][0].update(effective_from="2026-11-20",effective_to="2026-11-10")
        self.issue(value,"INVALID_PROFILE_RANGE")

    def test_irrelevant_old_profile_does_not_invent_current_gap(self):
        value=fixture();value["profiles"].append(profile(value["profiles"][0],id="old",effective_from="2019-01-01",effective_to="2019-12-31",is_active=False))
        self.assertEqual(run(value).net_total,D("1000"))

    def test_money_overflow_blocked_before_persistence(self):
        value=fixture(period_start="2026-10-01",period_end="2026-11-30")
        value["profiles"][0]["base_salary"]="9999999999999999.99"
        self.issue(value,"MONEY_OUT_OF_RANGE")

    def test_all_entry_totals_sum_exactly_and_no_float_snapshots(self):
        value=fixture(period_start="2026-11-16");value["profiles"][0].update(base_salary="1234.57",default_allowances=[{"name":"A","amount":"12.31"}],default_deductions=[{"name":"D","amount":"4.99"}])
        result=run(value);entry=result.entries[0]
        self.assertEqual(entry.gross_pay,entry.base_salary+entry.allowance_total)
        self.assertEqual(entry.net_pay+entry.deduction_total+entry.tax_amount,entry.gross_pay)
        self.assertEqual(result.net_total,sum((row.net_pay for row in result.entries),D(0)))
        output=json.loads(result.output_snapshot_json)
        self.assertIsInstance(output["net_total"],str)
        self.assertIsInstance(output["entries"][0]["base_salary"],str)

    def test_schema_decimal_precision_and_nonfinite_fail_closed(self):
        for amount in ["NaN","Infinity","-1","1.001","10000000000000000"]:
            with self.subTest(amount=amount):
                value=fixture();value["profiles"][0]["base_salary"]=amount
                with self.assertRaises(ValidationError):PayrollCalculationInput.model_validate(value)

    def test_schema_invalid_timezone_and_period_rejected(self):
        for patch in [{"timezone":"Not/A_Timezone"},{"period_end":"2026-10-31"}]:
            with self.subTest(patch=patch):
                with self.assertRaises(ValidationError):PayrollCalculationInput.model_validate(fixture(**patch))

    def test_configured_weekday_order_is_canonical(self):
        a=fixture("working_day");b=fixture("working_day")
        b["policy"]["config"]["working_weekdays"]=[4,2,1,3,0]
        self.assertEqual(run(a).calculation_hash,run(b).calculation_hash)

    def test_profile_and_employee_order_is_canonical(self):
        value=fixture();p=value["profiles"][0]
        value["employees"].append({**value["employees"][0],"id":"other"})
        value["profiles"]=[profile(p,effective_to="2026-11-15"),profile(p,id="new",effective_from="2026-11-16"),profile(p,id="other-profile",employee_id="other")]
        first=run(value)
        value["profiles"].reverse();value["employees"].reverse()
        self.assertEqual(run(value).calculation_hash,first.calculation_hash)

    def test_other_tenant_employee_and_holiday_rejected(self):
        for field in ["employees","holidays"]:
            with self.subTest(field=field):
                value=fixture(holidays=[holiday("2026-11-02")]);value[field][0]["organization_id"]="other"
                self.issue(value,"TENANT_MISMATCH")

    def test_legacy_seeded_differential_selection_and_totals(self):
        import random
        randomizer=random.Random(20261026)
        for trial in range(128):
            value=fixture(policy=None)
            value["employees"][0].update(join_date=None,employment_status="suspended")
            p=value["profiles"][0];rows=[]
            for index in range(8):
                day=index+1
                rows.append(profile(p,id=f"p-{index}",currency=randomizer.choice(["USD","BDT"]),effective_from=f"2026-11-{day:02d}",effective_to=randomizer.choice([None,"2026-11-30","2026-10-31"]),is_active=randomizer.choice([True,False]),base_salary=str(100+index),default_allowances=[{"name":"A","amount":"1.25"}],default_deductions=[{"name":"D","amount":"0.75"}]))
            randomizer.shuffle(rows);value["profiles"]=rows
            eligible=[r for r in rows if r["currency"]=="USD" and r["effective_from"]<="2026-11-30" and (r["effective_to"] is None or r["effective_to"]>="2026-11-01") and (r["is_active"] or r["effective_to"] is not None)]
            with self.subTest(trial=trial):
                if not eligible:self.issue(value,"NO_ELIGIBLE_PROFILES");continue
                expected=max(eligible,key=lambda r:r["effective_from"])
                result=run(value)
                self.assertEqual(result.entries[0].salary_profile_id,expected["id"])
                self.assertEqual(result.net_total,D(expected["base_salary"])+D("0.50"))


class PayrollPolicyManualFrequencyTests(unittest.TestCase):
    def test_manual_nonmonthly_requires_no_new_anchors(self):
        for mode in (None,"manual"):
            for frequency in ("weekly","biweekly"):
                with self.subTest(mode=mode,frequency=frequency):
                    value=fixture("manual")
                    if mode is None:value["policy"]=None
                    value["profiles"][0]["pay_frequency"]=frequency
                    self.assertEqual(run(value).net_total,D("1000"))

    def test_boolean_policy_version_rejected_not_interpreted_as_one(self):
        value=fixture();value["policy"]["version"]=True
        with self.assertRaises(ValidationError):PayrollCalculationInput.model_validate(value)

    def test_no_unrelated_database_or_runtime_modules_imported_by_engine(self):
        import ast
        from pathlib import Path
        for name in ("schemas","services"):
            tree=ast.parse((Path(__file__).parents[1]/"app"/name/"payroll_policy.py").read_text())
            imports=[node.module for node in ast.walk(tree) if isinstance(node,ast.ImportFrom)]
            self.assertFalse(any(module and (module.startswith("app.db") or module.startswith("app.core.config") or module.startswith("sqlalchemy")) for module in imports))


class PayrollPolicyHorizonTests(unittest.TestCase):
    def test_ended_employee_profile_does_not_require_irrelevant_cycle_anchor(self):
        value=fixture("working_day",period_start="2026-11-16",period_end="2026-11-20")
        value["employees"].append({**value["employees"][0],"id":"ended","employment_status":"terminated","end_date":"2026-10-31"})
        value["profiles"].append(profile(value["profiles"][0],id="ended-profile",employee_id="ended",pay_frequency="weekly"))
        data=PayrollCalculationInput.model_validate(value)
        self.assertEqual(payroll_reference_horizon(data.period_start,data.period_end,data.profiles,data.policy.config,employees=data.employees),(date(2026,11,1),date(2026,11,30)))
        self.assertEqual(run(value).employee_count,1)

    def test_future_employee_profile_does_not_require_irrelevant_cycle_anchor(self):
        value=fixture("working_day")
        value["employees"].append({**value["employees"][0],"id":"future","join_date":"2026-12-01"})
        value["profiles"].append(profile(value["profiles"][0],id="future-profile",employee_id="future",pay_frequency="biweekly"))
        data=PayrollCalculationInput.model_validate(value)
        self.assertEqual(payroll_reference_horizon(data.period_start,data.period_end,data.profiles,data.policy.config,employees=data.employees),(date(2026,11,1),date(2026,11,30)))

    def test_entry_snapshot_declares_rounding_contract(self):
        snapshot=json.loads(run(fixture()).entries[0].calculation_snapshot_json)
        self.assertEqual(snapshot["snapshot_version"],1)
        self.assertEqual(snapshot["rounding"],{"quantum":"0.01","mode":"ROUND_HALF_UP","base":"sum_slices_then_round","components":"sum_source_component_slices_then_round"})

    def test_input_snapshot_records_source_rows_and_deduplicated_effective_dates(self):
        value=fixture("working_day",holidays=[holiday("2026-11-02","a"),holiday("2026-11-02","b")])
        data=json.loads(run(value).input_snapshot_json)
        self.assertEqual(len(data["holidays"]),2)
        self.assertEqual(data["holiday_dates"],["2026-11-02"])


class PayrollPolicyCapacityTests(unittest.TestCase):
    issue=PayrollPolicyTests.issue

    def test_run_sum_overflow_rejected_even_when_each_entry_fits(self):
        value=fixture();value["profiles"][0]["base_salary"]="6000000000000000.00"
        value["employees"].append({**value["employees"][0],"id":"other"})
        value["profiles"].append(profile(value["profiles"][0],id="other-profile",employee_id="other"))
        self.issue(value,"MONEY_OUT_OF_RANGE")

    def test_entry_gross_overflow_rejected_before_db(self):
        value=fixture();value["profiles"][0].update(base_salary="9999999999999999.99",default_allowances=[{"name":"Overflow","amount":"0.01"}])
        self.issue(value,"MONEY_OUT_OF_RANGE")

    def test_extreme_period_fails_before_materializing_cycle_breakdown(self):
        from unittest.mock import patch
        value=fixture(period_end="9000-12-31")
        with patch("app.services.payroll_policy._automatic_entry",side_effect=AssertionError("must preflight before materialization")):
            self.issue(value,"CALCULATION_LIMIT_EXCEEDED")

    def test_budget_exact_boundary_and_one_over_no_financial_truncation(self):
        from unittest.mock import patch
        with patch("app.services.payroll_policy.MAX_BREAKDOWN_SLICES",2):
            self.assertEqual(run(fixture(period_end="2026-12-31")).net_total,D("2000"))
            self.issue(fixture(period_end="2027-01-31"),"CALCULATION_LIMIT_EXCEEDED")

    def test_approved_technical_budget_is_twenty_thousand(self):
        from app.services.payroll_policy import MAX_BREAKDOWN_SLICES
        self.assertEqual(MAX_BREAKDOWN_SLICES,20000)

    def test_weekly_budget_counts_cycles_exactly(self):
        from unittest.mock import patch
        value=fixture(period_start="2026-11-02",period_end="2026-11-15")
        value["profiles"][0]["pay_frequency"]="weekly"
        value["policy"]["config"]["weekly_anchor"]="2026-11-02"
        with patch("app.services.payroll_policy.MAX_BREAKDOWN_SLICES",2):
            self.assertEqual(run(value).net_total,D("2000"))
            value["period_end"]="2026-11-16"
            self.issue(value,"CALCULATION_LIMIT_EXCEEDED")

    def test_legacy_manual_period_not_subject_to_new_automatic_cycle_budget(self):
        from unittest.mock import patch
        with patch("app.services.payroll_policy.MAX_BREAKDOWN_SLICES",1):
            self.assertEqual(run(fixture(policy=None,period_end="9000-12-31")).net_total,D("1000"))
            self.assertEqual(run(fixture("manual",period_end="9000-12-31")).net_total,D("1000"))


class PayrollExactProrationTests(unittest.TestCase):
    def test_exact_half_cent_with_twenty_six_working_days(self):
        value=fixture("working_day",period_start="2026-06-01",period_end="2026-06-01")
        value["policy"]["config"]["working_weekdays"]=[0,1,2,3,4,5]
        value["profiles"][0]["base_salary"]="0.13"
        entry=run(value).entries[0]
        self.assertEqual(entry.base_salary,D("0.01"))
        snapshot=json.loads(entry.calculation_snapshot_json)
        self.assertEqual(snapshot["slices"][0]["denominator"],26)
        self.assertEqual(snapshot["unrounded_base_total_fraction"],{"numerator":"1","denominator":"200"})
        self.assertEqual(snapshot["unrounded_base_total"],"0.005")

    def test_exact_half_cent_prorated_component(self):
        value=fixture("working_day",period_start="2026-06-01",period_end="2026-06-01")
        value["policy"]["config"].update(working_weekdays=[0,1,2,3,4,5],allowance_treatment="prorate_profile_segments",deduction_treatment="prorate_profile_segments")
        value["profiles"][0].update(default_allowances=[{"name":"A","amount":"0.13"}],default_deductions=[{"name":"D","amount":"0.13"}])
        entry=run(value).entries[0]
        self.assertEqual(entry.allowance_total,D("0.01"));self.assertEqual(entry.deduction_total,D("0.01"))

    def test_zero_decimal_sign_is_not_a_different_semantic_input(self):
        value=fixture();value["profiles"][0]["default_allowances"]=[{"name":"Zero","amount":"0"}]
        first=run(value)
        value["profiles"][0]["default_allowances"][0]["amount"]="-0.00"
        self.assertEqual(run(value).calculation_hash,first.calculation_hash)

    def test_seeded_exact_rational_calendar_and_working_profile_split_oracle(self):
        from calendar import monthrange
        from fractions import Fraction
        from datetime import timedelta
        import random
        randomizer=random.Random(20261026)
        for trial in range(256):
            year=randomizer.choice([2026,2028]);month=randomizer.randint(1,12);last=monthrange(year,month)[1]
            start=date(year,month,1);end=date(year,month,last);change=randomizer.randint(2,last)
            join=randomizer.randint(1,last);leave=randomizer.randint(join,last)
            mode=randomizer.choice(["calendar_day","working_day"])
            value=fixture(mode,period_start=str(start),period_end=str(end))
            value["employees"][0].update(join_date=str(start.replace(day=join)),end_date=str(start.replace(day=leave)))
            weekdays=set(randomizer.sample(range(7),randomizer.randint(1,7)))
            holiday_days=set(randomizer.sample(range(1,last+1),randomizer.randint(0,min(4,last))))
            if mode=="working_day":value["policy"]["config"].update(working_weekdays=sorted(weekdays),holiday_treatment="exclude")
            value["holidays"]=[holiday(str(start.replace(day=day)),str(day)) for day in holiday_days]
            cents=[randomizer.randint(1,9999),randomizer.randint(1,9999)];allowance_cents=[randomizer.randint(0,100),randomizer.randint(0,100)];deduction_cents=[randomizer.randint(0,20),randomizer.randint(0,20)];p=value["profiles"][0]
            value["policy"]["config"].update(allowance_treatment="prorate_profile_segments",deduction_treatment="prorate_profile_segments")
            value["profiles"]=[profile(p,effective_to=str(start.replace(day=change-1)),base_salary=str(D(cents[0])/100)),profile(p,id="new",effective_from=str(start.replace(day=change)),base_salary=str(D(cents[1])/100))]
            for index,row in enumerate(value["profiles"]):
                row["default_allowances"]=[{"name":"Shared label","amount":str(D(allowance_cents[index])/100)}]
                row["default_deductions"]=[{"name":"Deduction","amount":str(D(deduction_cents[index])/100)}]
            all_days=[start+timedelta(days=offset) for offset in range(last)]
            counted=[day for day in all_days if mode=="calendar_day" or day.weekday() in weekdays and day.day not in holiday_days]
            denominator=len(counted)
            with self.subTest(trial=trial,mode=mode):
                if denominator==0:
                    with self.assertRaises(PayrollCalculationError):run(value)
                    continue
                counts=[0,0]
                for day in counted:
                    if join<=day.day<=leave:counts[0 if day.day<change else 1]+=1
                def rounded_cents(exact):
                    whole,remainder=divmod(exact.numerator,exact.denominator)
                    return D(whole+int(2*remainder>=exact.denominator))/100
                expected=rounded_cents(sum((Fraction(cents[index]*counts[index],denominator) for index in (0,1)),Fraction(0)))
                allowances=sum((rounded_cents(Fraction(allowance_cents[index]*counts[index],denominator)) for index in (0,1)),D(0))
                deductions=sum((rounded_cents(Fraction(deduction_cents[index]*counts[index],denominator)) for index in (0,1)),D(0))
                net=expected+allowances-deductions
                if net<0:
                    with self.assertRaises(PayrollCalculationError) as error:run(value)
                    self.assertEqual(error.exception.code,"NEGATIVE_NET")
                else:
                    entry=run(value).entries[0]
                    self.assertEqual((entry.base_salary,entry.allowance_total,entry.deduction_total,entry.net_pay),(expected,allowances,deductions,net))


class PayrollDenominatorOracleTests(unittest.TestCase):
    def test_all_one_through_thirty_one_denominators_against_exact_cent_oracle(self):
        for denominator in range(1,32):
            for numerator in range(1,denominator+1):
                for cents in (1,3,13,99,101,9999):
                    with self.subTest(denominator=denominator,numerator=numerator,cents=cents):
                        value=fixture("working_day",period_start="2026-01-01",period_end=f"2026-01-{numerator:02d}",holidays=[holiday(f"2026-01-{day:02d}",str(day)) for day in range(denominator+1,32)])
                        value["policy"]["config"].update(working_weekdays=[0,1,2,3,4,5,6],holiday_treatment="exclude")
                        value["profiles"][0]["base_salary"]=str(D(cents)/100)
                        whole,remainder=divmod(cents*numerator,denominator)
                        self.assertEqual(run(value).net_total,D(whole+int(2*remainder>=denominator))/100)

    def test_repeating_decimal_displays_are_explicitly_approximate_with_exact_fraction(self):
        value=fixture(period_start="2026-11-01",period_end="2026-11-01")
        value["policy"]["config"]["allowance_treatment"]="prorate_profile_segments"
        value["profiles"][0]["default_allowances"]=[{"name":"A","amount":"1.00"}]
        snapshot=json.loads(run(value).entries[0].calculation_snapshot_json)
        self.assertTrue(snapshot["unrounded_base_total_is_approximation"])
        self.assertTrue(snapshot["slices"][0]["unrounded_base_is_approximation"])
        self.assertEqual(snapshot["unrounded_base_total_fraction"],{"numerator":"100","denominator":"3"})
        component=snapshot["component_calculations"][0]
        self.assertTrue(component["display_is_approximation"])
        self.assertEqual(component["unrounded_amount_fraction"],{"numerator":"1","denominator":"30"})
        self.assertEqual(component["rounded_amount"],"0.03")


if __name__=="__main__":unittest.main()
