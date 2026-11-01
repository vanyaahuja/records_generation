from test_review_audit import extracted, accept


def test_overview_empty_and_range_validation(client):
    summary = client.get('/api/dashboard?days=30&end_date=2026-11-01').json()
    assert len(summary['daily']) == 30
    assert summary['daily'][-1]['date'] == '2026-11-01'
    assert not any(summary['totals'].values())
    assert sum(day['events'] for day in summary['daily']) == 0
    assert summary['recent_records'] == []
    for query in ['days=6', 'days=91', 'end_date=invalid']:
        assert client.get('/api/dashboard?' + query).status_code == 422


def test_overview_counts_every_head_beyond_list_limits_and_not_old_revisions(client):
    patient = client.post('/api/patients', json={'name':'Synthetic Overview','age':34,'gender':'female'}).json()
    client.post('/api/patients', json={'name':'Synthetic Unassigned','age':29,'gender':'male'})
    body = accept(extracted(client, 'At 14:05 gave 500 mg paracetamol orally. At 14:10 recorded blood pressure 120/80.'))
    body.update(patient_id=patient['patient_id'], encounter_date='2026-11-01')
    event_count = len(body['events'])
    ids = []
    for _ in range(101):
        response = client.post('/api/records', json=body)
        assert response.status_code == 200, response.text
        ids.append(response.json()['record_id'])
    body.update(events=body['events'][:1], expected_version=1)
    assert client.put('/api/records/'+ids[0],json=body).status_code == 200
    summary = client.get('/api/dashboard?days=7&end_date=2026-11-01').json()
    assert summary['totals']['patients'] == 2
    assert summary['totals']['records'] == 101
    assert summary['totals']['events'] == event_count * 100 + 1
    assert summary['totals']['pending_events'] == 0
    assert summary['totals']['accepted_events'] == summary['totals']['events']
    assert sum(summary['event_types'].values()) == summary['totals']['events']
    assert summary['daily'][-1]['records'] == 101
    assert len(summary['recent_records']) == 6
    assert client.get('/api/audit/verify').json()['valid']


def test_overview_pending_flags_survive_acknowledgment_without_fabricated_values(client):
    body = extracted(client, 'At 14:05 administered salbutamol by inhalation.')
    body = {key:body[key] for key in ['case_id','responder_id','narrative','events','extraction_id','encounter_date']}
    body['tz'] = 'Asia/Kolkata'
    body['encounter_date'] = '2026-11-01'
    saved = client.post('/api/records',json=body).json()
    summary = client.get('/api/dashboard?days=7&end_date=2026-11-01').json()
    assert summary['totals']['pending_events'] == 1
    assert summary['daily'][-1]['pending_events'] == 1
    assert summary['flags']['missing_dose'] == 1
    body['events'][0].update(review_status='confirmed',accepted_flags=body['events'][0]['flags'])
    body.update(record_status='reviewed',reviewer_id='Synthetic reviewer',expected_version=1)
    response = client.put('/api/records/'+saved['record_id'],json=body)
    assert response.status_code == 200, response.text
    summary = client.get('/api/dashboard?days=7&end_date=2026-11-01').json()
    assert summary['totals']['records'] == 1
    assert summary['totals']['pending_events'] == 0
    assert summary['totals']['accepted_events'] == 1
    assert summary['flags']['missing_dose'] == 1
    record = client.get('/api/records/'+saved['record_id']).json()['record']
    assert (record['events'][0].get('dose') or {}).get('value') is None
