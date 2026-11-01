from test_review_audit import extracted, accept


def test_patient_records_are_persistent_isolated_and_not_reassignable(client):
    a = client.post('/api/patients', json={'name':'Synthetic Alex','age':34,'gender':'female'}).json()
    b = client.post('/api/patients', json={'name':'Synthetic Sam','age':52,'gender':'not_specified'}).json()
    assert len(client.get('/api/patients').json()) == 2
    body = accept(extracted(client))
    body['patient_id'] = a['patient_id']
    response = client.post('/api/records', json=body)
    assert response.status_code == 200, response.text
    rid = response.json()['record_id']
    assert client.get('/api/records/'+rid).json()['record']['patient']['name'] == 'Synthetic Alex'
    records = client.get('/api/patients/'+a['patient_id']+'/records').json()
    assert records[0]['record_id'] == rid and records[0]['events']
    assert client.get('/api/patients/'+b['patient_id']+'/records').json() == []
    assert len(client.get('/api/records?q=Synthetic Alex').json()) == 1
    body.update(patient_id=b['patient_id'], expected_version=1)
    assert client.put('/api/records/'+rid, json=body).status_code == 409
    assert client.get('/api/audit/verify').json()['valid']


def test_patient_validation_and_missing_patient(client):
    for invalid in [{'name':'   ','age':30,'gender':'male'}, {'name':'Test','age':-1,'gender':'male'}, {'name':'Test','age':30.5,'gender':'male'}]:
        assert client.post('/api/patients', json=invalid).status_code == 422
    assert client.get('/api/patients/unknown/records').status_code == 404
    body = accept(extracted(client)); body['patient_id'] = 'unknown'
    assert client.post('/api/records', json=body).status_code == 404
