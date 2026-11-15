// Compact OpenAPI 3.0 description. Served at /api/openapi.json and rendered by Swagger UI at /api/docs.
// [method, path, tag, summary, roles, extra]
const R = [
  ['post', '/auth/login', 'Auth', 'Sign in (sets httpOnly session cookie)', 'public', { body: { email: 'string', password: 'string' } }],
  ['post', '/auth/logout', 'Auth', 'Sign out', 'public'],
  ['get', '/auth/me', 'Auth', 'Current user', 'any'],
  ['post', '/auth/change-password', 'Auth', 'Change own password (invalidates other sessions)', 'any', { body: { current_password: 'string', new_password: 'string' } }],

  ['get', '/classes', 'Academics', 'Classes with sections (teachers: only assigned sections)', 'admin, teacher'],
  ['post', '/classes', 'Academics', 'Create class', 'admin', { body: { name: 'string', academic_year: '2025-2026' } }],
  ['patch', '/classes/{id}', 'Academics', 'Update class', 'admin'],
  ['delete', '/classes/{id}', 'Academics', 'Delete empty class', 'admin'],
  ['post', '/sections', 'Academics', 'Create section', 'admin', { body: { class_id: 'integer', name: 'string', capacity: 'integer' } }],
  ['patch', '/sections/{id}', 'Academics', 'Update section', 'admin'],
  ['delete', '/sections/{id}', 'Academics', 'Delete empty section', 'admin'],
  ['get', '/subjects', 'Academics', 'List subjects', 'any'],
  ['post', '/subjects', 'Academics', 'Create subject', 'admin', { body: { code: 'string', name: 'string' } }],
  ['patch', '/subjects/{id}', 'Academics', 'Update subject', 'admin'],
  ['delete', '/subjects/{id}', 'Academics', 'Delete unused subject', 'admin'],
  ['get', '/assignments', 'Academics', 'Class/subject assignments (teachers: own only)', 'admin, teacher'],
  ['post', '/assignments', 'Academics', 'Assign teacher to section+subject', 'admin', { body: { teacher_id: 'integer', section_id: 'integer', subject_id: 'integer' } }],
  ['delete', '/assignments/{id}', 'Academics', 'Remove assignment', 'admin'],

  ['get', '/students', 'People', 'Search/filter/paginate students (row-level scoped by role)', 'any', { query: ['q', 'section_id', 'class_id', 'status', 'sort', 'page', 'pageSize'] }],
  ['post', '/students', 'People', 'Create student (capacity enforced)', 'admin'],
  ['get', '/students/{id}', 'People', 'Student detail', 'any (scoped)'],
  ['patch', '/students/{id}', 'People', 'Update student', 'admin'],
  ['post', '/students/{id}/guardians', 'People', 'Link guardian', 'admin'],
  ['delete', '/students/{id}/guardians/{gid}', 'People', 'Unlink guardian', 'admin'],
  ['post', '/students/bulk-move', 'People', 'Move all active students between sections', 'admin'],
  ['get', '/teachers', 'People', 'List teachers', 'admin', { query: ['q', 'active', 'page', 'pageSize'] }],
  ['post', '/teachers', 'People', 'Create teacher account', 'admin'],
  ['patch', '/teachers/{id}', 'People', 'Update/deactivate teacher', 'admin'],
  ['post', '/teachers/{id}/reset-password', 'People', 'Reset teacher password', 'admin'],
  ['get', '/guardians', 'People', 'List guardians', 'admin, teacher (own sections)', { query: ['q', 'active', 'page', 'pageSize'] }],
  ['post', '/guardians', 'People', 'Create guardian account', 'admin'],
  ['patch', '/guardians/{id}', 'People', 'Update/deactivate guardian', 'admin'],
  ['post', '/guardians/{id}/reset-password', 'People', 'Reset guardian password', 'admin'],

  ['get', '/attendance/roster', 'Attendance', 'Roster for section/date/session with current marks', 'admin, teacher (assigned)', { query: ['section_id', 'date', 'session'] }],
  ['put', '/attendance', 'Attendance', 'Bulk upsert attendance. UNIQUE(student,date,session): resubmitting updates, never duplicates', 'admin, teacher (assigned)', { body: { section_id: 'integer', date: 'YYYY-MM-DD', session: 'morning|afternoon', records: '[{student_id,status,note}]' } }],
  ['get', '/attendance/summary', 'Attendance', 'Class summary per student', 'admin, teacher (assigned)', { query: ['section_id', 'from', 'to'] }],
  ['get', '/attendance/student/{id}', 'Attendance', 'Student summary and recent records', 'any (scoped)'],

  ['get', '/grading-rules', 'Exams', 'Grading rules with bands', 'admin, teacher'],
  ['post', '/grading-rules', 'Exams', 'Create grading rule', 'admin'],
  ['put', '/grading-rules/{id}', 'Exams', 'Replace rule and bands (locked once used by a published exam)', 'admin'],
  ['delete', '/grading-rules/{id}', 'Exams', 'Delete unused rule', 'admin'],
  ['get', '/exams', 'Exams', 'List visible exams', 'any (scoped)'],
  ['post', '/exams', 'Exams', 'Create exam with subjects and max/pass marks', 'admin'],
  ['get', '/exams/{id}', 'Exams', 'Exam detail', 'any (scoped)'],
  ['patch', '/exams/{id}', 'Exams', 'Edit draft exam', 'admin'],
  ['delete', '/exams/{id}', 'Exams', 'Delete draft exam', 'admin'],
  ['post', '/exams/{id}/status', 'Exams', 'State machine: draft -> open -> published (publish requires complete marks unless force)', 'admin', { body: { status: 'draft|open|published', force: 'boolean' } }],
  ['get', '/exams/{id}/marks', 'Exams', 'Marks sheet for section+subject', 'admin, teacher (teaches subject)', { query: ['section_id', 'subject_id'] }],
  ['put', '/exams/{id}/marks', 'Exams', 'Save marks (exam must be open; marks <= max)', 'admin, teacher (teaches subject)'],
  ['get', '/exams/{id}/results', 'Exams', 'Computed results + ranks for a section', 'admin, teacher (assigned)', { query: ['section_id'] }],
  ['get', '/report-cards/{studentId}', 'Exams', 'Exams with a report card for the student', 'any (scoped)'],
  ['get', '/report-cards/{studentId}/{examId}', 'Exams', 'Report card (guardians: published only)', 'any (scoped)'],

  ['get', '/fees/invoices', 'Fees', 'Search/filter/paginate invoices', 'admin, guardian (own children)', { query: ['q', 'student_id', 'section_id', 'status', 'overdue', 'page', 'pageSize'] }],
  ['post', '/fees/invoices', 'Fees', 'Create invoice for student, section or class', 'admin', { body: { student_id: 'integer?', section_id: 'integer?', class_id: 'integer?', title: 'string', amount: 'number', due_date: 'YYYY-MM-DD' } }],
  ['get', '/fees/invoices/{id}', 'Fees', 'Invoice with ledger', 'admin, guardian (own children)'],
  ['post', '/fees/invoices/{id}/void', 'Fees', 'Void unpaid invoice', 'admin', { body: { reason: 'string' } }],
  ['post', '/fees/invoices/{id}/payments', 'Fees', 'Record SIMULATED payment. Requires Idempotency-Key header', 'admin, guardian (own children)', { body: { amount: 'number', method: 'card|bank_transfer|cash|upi' }, headers: ['Idempotency-Key'] }],
  ['get', '/fees/students/{id}/ledger', 'Fees', 'Ledger and reconciled totals', 'admin, guardian (own children)'],
  ['get', '/fees/summary', 'Fees', 'School-wide fee totals', 'admin'],

  ['get', '/reports/dashboard', 'Reports', 'Role-specific dashboard', 'any'],
  ['get', '/reports/attendance', 'Reports', 'Attendance report (format=csv supported)', 'admin, teacher (assigned)', { query: ['from', 'to', 'class_id', 'section_id', 'threshold', 'format'] }],
  ['get', '/reports/academic', 'Reports', 'Academic report for an exam (format=csv supported)', 'admin, teacher (assigned)', { query: ['exam_id', 'section_id', 'format'] }],
  ['get', '/reports/fees', 'Reports', 'Fee collection report (format=csv supported)', 'admin', { query: ['class_id', 'status', 'q', 'format'] }],
  ['get', '/audit', 'Audit', 'Audit trail (append-only)', 'admin', { query: ['entity', 'action', 'q', 'page', 'pageSize'] }],
  ['get', '/health', 'System', 'Liveness check', 'public'],
];

const paths = {};
for (const [method, p, tag, summary, roles, extra = {}] of R) {
  const params = [...(p.match(/\{(\w+)\}/g) ?? []).map((m) => ({ name: m.slice(1, -1), in: 'path', required: true, schema: { type: 'string' } })),
    ...(extra.query ?? []).map((n) => ({ name: n, in: 'query', schema: { type: 'string' } })),
    ...(extra.headers ?? []).map((n) => ({ name: n, in: 'header', required: true, schema: { type: 'string' } }))];
  (paths[p] ??= {})[method] = {
    tags: [tag], summary, description: `**Roles:** ${roles}`, parameters: params,
    ...(extra.body ? { requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', example: extra.body } } } } } : {}),
    responses: {
      200: { description: 'Success: { data, meta? }' },
      400: { $ref: '#/components/responses/Error' }, 401: { $ref: '#/components/responses/Error' },
      403: { $ref: '#/components/responses/Error' }, 404: { $ref: '#/components/responses/Error' },
      409: { $ref: '#/components/responses/Error' }, 422: { $ref: '#/components/responses/Error' },
    },
  };
}

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'School Management System API', version: '1.0.0',
    description: 'All endpoints are under /api and require the `sms_token` httpOnly cookie (obtain via POST /auth/login) except where marked public.\n\nSuccess: `{ "data": ..., "meta": { page, pageSize, total, pages } }`.\nErrors: `{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": {...} } }` with codes such as BAD_REQUEST, VALIDATION_ERROR, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, CONFLICT, INVALID_STATE, OVERPAYMENT, IDEMPOTENCY_KEY_REUSED, RATE_LIMITED.',
  },
  servers: [{ url: '/api' }],
  tags: [...new Set(R.map((x) => x[2]))].map((name) => ({ name })),
  paths,
  components: {
    securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'sms_token' } },
    responses: { Error: { description: 'Error', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: { type: 'object' } } } } } } } } },
  },
  security: [{ cookieAuth: [] }],
};

export const docsHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>SMS API docs</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css"></head>
<body><div id="ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
<script>window.ui = SwaggerUIBundle({ url: '/api/openapi.json', dom_id: '#ui', deepLinking: true });</script></body></html>`;
