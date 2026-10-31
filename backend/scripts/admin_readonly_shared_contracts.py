"""Source-reviewed GET-only readiness for shared admin views; no security action."""
def shared_route_contracts(organization_name: str, owner_name: str):
    contracts = {}
    def add(route, heading, source, paths=(), texts=(), button=None):
        item = {'heading': heading, 'heading_level': 1, 'ready_text': list(texts),
                'expected_get_paths': list(paths), 'source': 'frontend/src/' + source,
                'expected_mode': 'ready'}
        if button: item['ready_button'] = button
        contracts[route] = item
    add('/dashboard', 'Business overview', 'app/dashboard/page.tsx',
        ('/api/reports/dashboard', '/api/reports/dashboard-series'), ('Business trends', 'Quick entry'))
    add('/dashboard/company', organization_name, 'app/dashboard/company/page.tsx',
        ('/api/company-settings',), ('Company identity, localization, currencies, finance, system defaults and documents in one workspace.',))
    add('/dashboard/company/defaults', 'System Defaults', 'app/dashboard/company/defaults/page.tsx',
        ('/api/company-settings/system-defaults',))
    add('/dashboard/activity-logs', 'Company Activity Logs', 'app/dashboard/activity-logs/page.tsx',
        ('/api/tenant/activity-logs',), ('Activity history',))
    add('/dashboard/notifications', 'Notifications', 'app/dashboard/notifications/page.tsx',
        ('/api/workspace/notifications',), button='Refresh')
    add('/dashboard/capital', 'Investments & Funding', 'app/dashboard/capital/page.tsx',
        ('/api/capital/dashboard',), ('Capital position by currency',), 'Refresh')
    add('/dashboard/capital/insights', 'Funding Insights & Settlement', 'app/dashboard/capital/insights/page.tsx',
        ('/api/capital/insights',), ('Capital P&L Impact',), 'Refresh')
    add('/dashboard/reports', 'Reports', 'components/operational-reports/report-workspace.tsx',
        ('/api/reports/meta', '/api/reports/overview'), button='Refresh results')
    profiles = {
        '': ('Your account', (), (owner_name, 'Personal details')),
        '/edit': ('Personal details', (), ('Full name',)),
        '/photo': ('Profile photo', (), ('Your profile photo',)),
        '/security': ('Sign-in & security', ('/api/profile/identities',), ('Choose a security task',)),
        '/security/google': ('Google sign-in', (), ('Only a Google account with the same primary email can be linked.',)),
        '/security/passkeys': ('Your passkeys', ('/api/profile/passkeys',), ('Saved passkeys',)),
        '/security/passkeys/new': ('Add a passkey', ('/api/profile/passkeys',), ('Add a named passkey',)),
        '/security/password': ('Password', (), ('Change your password',)),
        '/security/sessions': ('Devices & sessions', ('/api/profile/sessions',), ('Current access', 'Recent session history')),
        '/security/username': ('Your username', ('/api/profile/identities',), ('Choose your optional username',)),
    }
    for suffix, (heading, paths, texts) in profiles.items():
        add('/dashboard/profile' + suffix, heading, 'components/profile/profile-workspace.tsx',
            ('/api/profile',) + paths, texts)
    return contracts
