"""CP05/CP06 isolated route/service logic; no DB, HTTP, auth sessions or browser.

Mock session return values cannot prove persistence, SQL isolation or browser
behavior. Historical PostgreSQL tests and remaining real UI checks are separate.
"""
import os
os.environ['ENVIRONMENT'] = 'test'
os.environ['DATABASE_URL'] = 'postgresql+psycopg://unused@127.0.0.1:1/unit_never_connect'
import socket
import unittest
from decimal import Decimal
from types import SimpleNamespace as NS
from unittest.mock import Mock, patch
from fastapi import HTTPException
from sqlalchemy.engine import Engine
with patch.object(Engine, 'connect', side_effect=AssertionError('No DB connections in unit tests')):
    from app.api.v1 import client_access as access, client_portal as portal, sales


def sql(statement):
    return str(statement.compile(compile_kwargs={'literal_binds': True}))


class ClientDecisionUnits(unittest.TestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        patch.object(Engine, 'connect', side_effect=AssertionError('No DB connections')).start()
        patch.object(socket.socket, 'connect', side_effect=AssertionError('No network')).start()
        self.tenant = NS(organization_id='unit-org', membership_id='unit-member', user_id='unit-user')

    def test_orphan_only_deactivates_without_other_active_relationship(self):
        for employee, other_client, expected in [(None,None,'left'),('employee',None,'active'),(None,'link','active'),('employee','link','active')]:
            with self.subTest(employee=employee, other_client=other_client):
                member=NS(id='unit-member',is_owner=False,status='active')
                db=Mock();db.get.return_value=member;db.scalar.side_effect=[employee,other_client]
                access._deactivate_membership_if_orphaned(db,'unit-org',member.id)
                self.assertEqual(member.status,expected)
                for call in db.scalar.call_args_list:
                    query=sql(call.args[0])
                    self.assertIn("'unit-org'",query);self.assertIn("'unit-member'",query);self.assertIn("'active'",query)
                db.commit.assert_not_called()

    def test_owner_and_missing_membership_never_deactivated(self):
        for member in [None,NS(id='owner',is_owner=True,status='active')]:
            db=Mock();db.get.return_value=member
            access._deactivate_membership_if_orphaned(db,'unit-org','owner')
            db.scalar.assert_not_called()
            if member:self.assertEqual(member.status,'active')

    def test_revoke_flushes_before_orphan_query_and_audits_once(self):
        link=NS(id='access',client_id='client',membership_id='unit-member',is_primary_contact=True,status='active')
        member=NS(id='unit-member',is_owner=False,status='active')
        db=Mock();db.get.return_value=member;calls=[]
        def scalar(statement):
            calls.append(sql(statement))
            if len(calls)==1:return link
            self.assertEqual(link.status,'revoked');self.assertTrue(db.flush.called)
            return None
        db.scalar.side_effect=scalar
        with patch.object(access,'record_activity') as audit:
            access.revoke_client_access('access',None,db,self.tenant)
            self.assertEqual(link.status,'revoked');self.assertEqual(member.status,'left')
            self.assertIn("'unit-org'",calls[0]);self.assertIn("'access'",calls[0])
            audit.assert_called_once();self.assertEqual(audit.call_args.kwargs['before']['status'],'active')
            self.assertEqual(audit.call_args.kwargs['after'],{'status':'revoked','membership_status':'left'})
            db.commit.assert_called_once()

    def test_missing_access_is_404_without_mutation(self):
        db=Mock();db.scalar.return_value=None
        with patch.object(access,'record_activity') as audit,self.assertRaises(HTTPException) as err:
            access.revoke_client_access('missing',None,db,self.tenant)
        self.assertEqual(err.exception.status_code,404);db.flush.assert_not_called();db.commit.assert_not_called();audit.assert_not_called()

    def test_bulk_disable_flushes_all_links_before_membership_checks(self):
        links=[NS(id='a',membership_id='m1',status='active'),NS(id='b',membership_id='m2',status='active')]
        db=Mock();db.scalars.return_value.all.return_value=links
        def deactivate(*args):
            self.assertTrue(db.flush.called);self.assertTrue(all(x.status=='revoked' for x in links))
        with patch.object(access,'_client',return_value=NS(id='c',display_name='Synthetic')),patch.object(access,'_deactivate_membership_if_orphaned',side_effect=deactivate) as orphan,patch.object(access,'record_activity') as audit:
            access.disable_client_access('c',None,db,self.tenant)
            self.assertEqual(orphan.call_count,2);audit.assert_called_once();db.commit.assert_called_once()

    def test_bulk_disable_without_active_links_does_not_write(self):
        db=Mock();db.scalars.return_value.all.return_value=[]
        with patch.object(access,'_client',return_value=NS(id='c')),patch.object(access,'record_activity') as audit:
            access.disable_client_access('c',None,db,self.tenant)
            db.flush.assert_not_called();db.commit.assert_not_called();audit.assert_not_called()

    def test_reject_first_preserves_amount_and_sets_only_rejection_timestamp(self):
        quotation=NS(id='q',quotation_number='Q-UNIT',status='sent',total=Decimal('50.00'),currency='USD',accepted_at=None,rejected_at=None,cancelled_at=None)
        db=Mock();db.scalar.return_value=quotation
        with patch.object(sales,'_require_latest_revision'),patch.object(sales,'_detail',return_value='detail'),patch.object(sales,'record_activity') as audit:
            result=sales.change_quotation_status('q',sales.QuotationStatusChange(status='rejected',reason='Synthetic'),None,db,self.tenant)
            self.assertEqual(result,'detail');self.assertEqual(quotation.status,'rejected');self.assertIsNotNone(quotation.rejected_at)
            self.assertIsNotNone(quotation.rejected_at.tzinfo);self.assertIsNone(quotation.accepted_at);self.assertIsNone(quotation.cancelled_at)
            self.assertEqual(quotation.total,Decimal('50.00'));self.assertEqual(quotation.currency,'USD')
            self.assertEqual(audit.call_args.kwargs['before'],{'status':'sent'});self.assertEqual(audit.call_args.kwargs['after'],{'status':'rejected'})
            db.commit.assert_called_once()

    def test_terminal_quote_reversal_has_no_side_effects(self):
        for status,target in [('accepted','rejected'),('rejected','accepted'),('cancelled','rejected')]:
            with self.subTest(status=status):
                quotation=NS(id='q',status=status);db=Mock();db.scalar.return_value=quotation
                with patch.object(sales,'_require_latest_revision'),patch.object(sales,'record_activity') as audit,self.assertRaises(HTTPException) as err:
                    sales.change_quotation_status('q',sales.QuotationStatusChange(status=target),None,db,self.tenant)
                self.assertEqual(err.exception.status_code,409);self.assertEqual(quotation.status,status)
                db.flush.assert_not_called();db.commit.assert_not_called();audit.assert_not_called()

    def test_portal_terminal_quote_rejects_repeat_before_transition(self):
        for status in ['accepted','rejected']:
            db=Mock();db.scalar.return_value=NS(status=status)
            with patch.object(portal,'_client_portal_client_ids',return_value=['client']),patch.object(portal,'change_quotation_status') as change,self.assertRaises(HTTPException) as err:
                portal.decide_client_portal_quotation('q',portal.ClientPortalQuotationDecision(status='rejected'),None,db,self.tenant)
            self.assertEqual(err.exception.status_code,409);change.assert_not_called();db.commit.assert_not_called()

    def test_portal_missing_quote_is_404_and_query_is_scoped(self):
        db=Mock();db.scalar.return_value=None
        with patch.object(portal,'_client_portal_client_ids',return_value=['allowed-client']),patch.object(portal,'change_quotation_status') as change,self.assertRaises(HTTPException) as err:
            portal.decide_client_portal_quotation('q',portal.ClientPortalQuotationDecision(status='rejected'),None,db,self.tenant)
        self.assertEqual(err.exception.status_code,404);change.assert_not_called()
        query=sql(db.scalar.call_args.args[0])
        for required in ["'unit-org'","'allowed-client'","'draft'","'cancelled'"]:self.assertIn(required,query)

    def test_portal_without_active_relationship_denied(self):
        db=Mock();db.execute.return_value.all.return_value=[]
        with self.assertRaises(HTTPException) as err:portal._client_portal_client_ids(db,self.tenant)
        self.assertEqual(err.exception.status_code,403)
        query=sql(db.execute.call_args.args[0])
        for required in ["'unit-org'","'unit-member'","'active'"]:self.assertIn(required,query)

if __name__=='__main__':unittest.main()
