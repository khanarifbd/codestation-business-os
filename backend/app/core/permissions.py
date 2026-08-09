PERMISSION_CATALOG = [
    "dashboard.view",
    "company.view",
    "company.manage",
    "employees.view",
    "employees.manage",
    "employees.invite",
    "departments.manage",
    "designations.manage",
    "roles.view",
    "roles.manage",
    "activity_logs.view",
    "crm.view",
    "crm.manage",
    "clients.view",
    "clients.manage",
    "quotations.view",
    "quotations.manage",
    "orders.view",
    "orders.manage",
    "projects.view",
    "projects.work",
    "projects.manage",
    "finance.view",
    "finance.manage",
    "payroll.view",
    "payroll.manage",
    "hr.self",
    "hr.view",
    "hr.manage",
    "reports.view",
    "settings.manage",
]

ADMIN_PERMISSIONS = ["*"]
USER_PERMISSIONS = ["dashboard.view", "projects.view", "projects.work", "hr.self"]


def permission_is_valid(permission: str) -> bool:
    return permission in PERMISSION_CATALOG
