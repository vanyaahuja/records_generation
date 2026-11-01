from test_review_audit import extracted, accept


def test_oxygen_saturation_is_not_an_oxygen_administration(client):
    events = extracted(client, 'At 14:05 recorded oxygen saturation 97 percent.')['events']
    assert len(events) == 1
    assert events[0]['event_type'] == 'observation' and events[0]['soap_section'] == 'O'
    mixed = extracted(client, 'At 14:05 administered oxygen by nasal cannula. At 14:07 recorded oxygen saturation 97 percent.')['events']
    assert [event['event_type'] for event in mixed] == ['medication_administration', 'observation']


def test_soap_tables_are_source_only_and_exported(client):
    body = accept(extracted(client, "At 14:05 gave 500 mg paracetamol orally. At 14:10 recorded blood pressure 120/80. At 14:12 performed bandaging."))
    body["document_format"] = "soap"
    response = client.post('/api/records', json=body)
    assert response.status_code == 200, response.text
    rid = response.json()['record_id']
    exported = client.get(f'/api/records/{rid}/soap').json()
    sections = {section['code']:section['rows'] for section in exported['sections']}
    assert not sections['S'] and not sections['A']
    assert len(sections['O']) == 1 and len(sections['P']) == 2
    assert '120/80' in sections['O'][0]['value']
    assert '500 mg' in sections['P'][0]['value']
    assert sections['P'][0]['action_status'] == 'completed'
    assert client.get(f'/api/records/{rid}/json').json()['soap'] == exported
    html = client.get(f'/api/records/{rid}/html').text
    assert '<table>' in html and 'Not documented' in html and 'Assessment' in html
    assert 'Subjective' in client.get(f'/api/records/{rid}/text').text
    assert client.get(f'/api/records/{rid}/pdf').content.startswith(b'%PDF')
    assert client.get('/api/audit/verify').json()['valid']


def test_explicit_soap_statements_do_not_infer_assessment(client):
    result = extracted(client, 'Subjective: Patient reports dizziness. Assessment: responder documented uncertainty. Plan: handover to receiving team.')
    assert [event['soap_section'] for event in result['events']] == ['S','A','P']
    assert all(event['source_text'] for event in result['events'])


def test_uncategorized_soap_requires_reviewed_categorization(client):
    body = accept(extracted(client, 'Crew arrived on scene.'))
    assert body['events'][0]['soap_section'] is None
    body['document_format'] = 'soap'
    assert client.post('/api/records',json=body).status_code == 422
    body['events'][0]['soap_section'] = 'O'
    response = client.post('/api/records',json=body)
    assert response.status_code == 200, response.text
    rid = response.json()['record_id']
    record = client.get(f'/api/records/{rid}').json()['record']
    assert record['events'][0]['review_status'] == 'corrected'
    assert record['events'][0]['fields']['soap_section']['status'] == 'corrected'
    assert client.get(f'/api/records/{rid}/original').json()['events'][0]['soap_section'] is None
    assert client.get('/api/audit/verify').json()['valid']
