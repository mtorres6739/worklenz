\set ON_ERROR_STOP on

BEGIN;

INSERT INTO users (id, name, email, timezone_id)
VALUES
  (
    '10000000-0000-4000-8000-000000000001',
    'Invoice Staff A',
    'invoice-a@example.test',
    (SELECT id FROM timezones LIMIT 1)
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'Invoice Staff B',
    'invoice-b@example.test',
    (SELECT id FROM timezones LIMIT 1)
  );

INSERT INTO teams (id, name, user_id)
VALUES
  (
    '20000000-0000-4000-8000-000000000001',
    'Team A',
    '10000000-0000-4000-8000-000000000001'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    'Team B',
    '10000000-0000-4000-8000-000000000002'
  );

INSERT INTO clients (id, name, team_id)
VALUES
  (
    '30000000-0000-4000-8000-000000000001',
    'Client A',
    '20000000-0000-4000-8000-000000000001'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    'Client B',
    '20000000-0000-4000-8000-000000000002'
  );

INSERT INTO portal_services
  (id, team_id, created_by, name, service_key)
VALUES
  (
    '40000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'Website',
    'WEB1'
  );

INSERT INTO portal_requests
  (id, request_number, request_no, team_id, client_id, service_id)
VALUES
  (
    '50000000-0000-4000-8000-000000000001',
    1,
    'REQ-1',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001'
  );

INSERT INTO portal_invoices
  (
    id, invoice_no, team_id, client_id, request_id, created_by_user_id,
    status, subtotal, amount
  )
VALUES
  (
    '60000000-0000-4000-8000-000000000001',
    'INV-TEST-A',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'sent',
    100,
    100
  );

DO $$
BEGIN
  BEGIN
    INSERT INTO portal_invoice_items
      (
        invoice_id, team_id, client_id, position, description, quantity,
        unit_amount, line_amount
      )
    VALUES
      (
        '60000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001',
        0,
        'Bad total',
        2,
        50,
        99
      );
    RAISE EXCEPTION 'invoice item amount constraint failed open';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO portal_invoice_payments
      (
        invoice_id, team_id, client_id, provider, status, amount, currency,
        idempotency_key
      )
    VALUES
      (
        '60000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000002',
        '30000000-0000-4000-8000-000000000002',
        'manual',
        'succeeded',
        100,
        'USD',
        'cross-tenant'
      );
    RAISE EXCEPTION 'invoice payment scope constraint failed open';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO portal_invoice_payments
      (
        invoice_id, team_id, client_id, provider, status, amount, currency,
        refunded_amount, idempotency_key
      )
    VALUES
      (
        '60000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001',
        'stripe',
        'refunded',
        100,
        'USD',
        101,
        'invalid-refund'
      );
    RAISE EXCEPTION 'refund amount constraint failed open';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  INSERT INTO portal_invoice_payments
    (
      invoice_id, team_id, client_id, provider, status, amount, currency,
      idempotency_key
    )
  VALUES
    (
      '60000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'stripe',
      'checkout_pending',
      100,
      'USD',
      'active-checkout'
    );

  BEGIN
    INSERT INTO portal_invoice_payments
      (
        invoice_id, team_id, client_id, provider, status, amount, currency,
        idempotency_key
      )
    VALUES
      (
        '60000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001',
        'manual',
        'pending_review',
        100,
        'USD',
        'racing-manual-payment'
      );
    RAISE EXCEPTION 'active payment uniqueness failed open';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
END
$$;

ROLLBACK;
