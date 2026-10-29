"""Retest QA V2 PRJ15/SET06: retrieve actual PDF bytes, not just print views.

Run only against an isolated local QA database with Existing Tenant Fixture.
"""
from io import BytesIO
from uuid import uuid4
from hashlib import sha256

from fastapi import FastAPI, UploadFile
from fastapi.testclient import TestClient
from sqlalchemy import select
from starlette.datastructures import Headers
from starlette.requests import Request

from app.api.v1.company_uploads import upload_company_document, download_company_document
from app.api.v1.project_execution import upload_project_document, download_project_document
from app.core.config import settings
from app.db.session import SessionLocal
from app.models.organization import Organization
from app.models.membership import Membership
from app.models.user import User
from app.models.projects import Project
from app.tenancy.context import TenantContext

def synthetic_pdf():
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>", b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>", b"<< /Length 0 >>\nstream\n\nendstream"]
    content = b"%PDF-1.4\n"
    offsets = [0]
    for number, obj in enumerate(objects, 1):
        offsets.append(len(content))
        content += str(number).encode() + b" 0 obj\n" + obj + b"\nendobj\n"
    xref = len(content)
    content += b"xref\n0 5\n0000000000 65535 f \n" + b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets[1:])
    return content + f"trailer\n<< /Root 1 0 R /Size 5 >>\nstartxref\n{xref}\n%%EOF\n".encode()

PDF = synthetic_pdf()

def request():
    return Request({'type':'http','method':'POST','path':'/qa/local-documents','headers':[], 'query_string':b'', 'client':('127.0.0.1',50000),'server':('localhost',8000),'scheme':'http'})

def upload():
    return UploadFile(file=BytesIO(PDF), filename='synthetic-review.pdf', headers=Headers({'content-type':'application/pdf'}))

def assert_download(response, label):
    app=FastAPI()
    @app.get('/download')
    def download():
        return response
    with TestClient(app) as client:
        result=client.get('/download')
    assert result.status_code == 200
    assert result.content == PDF, label
    assert result.headers['content-type'] == 'application/pdf'
    assert result.headers['content-disposition'].startswith('attachment;')
    assert '.pdf' in result.headers['content-disposition']
    print(f'{label}: downloaded {len(result.content)} exact PDF bytes; SHA256 {sha256(result.content).hexdigest()}')

def main():
    assert settings.environment == 'test', 'Use isolated test environment only'
    assert '@127.0.0.1:' in settings.database_url, 'Use local PostgreSQL only'
    with SessionLocal() as db:
        org=db.scalar(select(Organization).where(Organization.name=='Existing Tenant Fixture'))
        assert org
        user=db.get(User,org.created_by_user_id)
        member=db.scalar(select(Membership).where(Membership.organization_id==org.id,Membership.user_id==user.id,Membership.status=='active'))
        tenant=TenantContext(user=user,organization=org,membership=member)
        marker=uuid4().hex[:8]
        company=upload_company_document(request(),db,tenant,upload(),'other',f'Local QA Download {marker}')
        assert_download(download_company_document(company.id,db,tenant),'SET06 company PDF')
        project=db.scalar(select(Project).where(Project.organization_id==org.id,Project.status.in_(['active','planned'])))
        assert project, 'Run existing project fixtures first'
        document=upload_project_document(project.id,request(),db,tenant,upload(),f'Local QA Download {marker}')
        assert_download(download_project_document(project.id,document.id,db,tenant),'PRJ15 project PDF')
    print('PASS: actual HTTP file bodies and attachment headers verified; browser UI is a separate check')

if __name__=='__main__':
    main()
