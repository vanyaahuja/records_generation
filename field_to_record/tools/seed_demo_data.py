"""Append labeled synthetic draft notes to one explicitly selected patient."""
import argparse
import math
import re
from datetime import date, timedelta
import httpx


def seed(base_url, patient_id, notes=20, end_date=None, repair_mock_overlaps=False):
    ending = date.fromisoformat(end_date) if end_date else date.today()
    with httpx.Client(base_url=base_url, timeout=30) as client:
        profiles = client.get('/api/patients'); profiles.raise_for_status()
        patient = next((p for p in profiles.json() if p['patient_id'] == patient_id), None)
        if not patient:
            raise ValueError('Patient ID not found; no data was written.')
        existing = client.get('/api/records', params={'patient_id':patient_id,'limit':100,'q':'MOCK-VIS-'}); existing.raise_for_status()
        case_ids = {r['case_id'] for r in existing.json()}
        repaired = removed = 0
        if repair_mock_overlaps:
            for summary in existing.json():
                bundle = client.get('/api/records/'+summary['record_id']); bundle.raise_for_status()
                record = bundle.json()['record']
                if record.get('record_status') != 'pending_review' or record.get('responder_id') != 'MOCK-DATA-GENERATOR' or 'SYNTHETIC MOCK DATA:' not in record['narrative']:
                    continue
                filtered = [event for event in record['events'] if not (event.get('medication')=='oxygen' and re.search(r'\brecorded oxygen saturation\b',event['source_text'],re.I) and not event.get('dose') and not event.get('route'))]
                if len(filtered) == len(record['events']):
                    continue
                body = {key:record[key] for key in ['case_id','responder_id','narrative','extraction_id','encounter_date','tz']}
                body.update(events=filtered,patient_id=patient_id,document_format='soap',record_status='pending_review',expected_version=bundle.json()['version'])
                response = client.put('/api/records/'+summary['record_id'],json=body); response.raise_for_status()
                repaired += 1
                removed += len(record['events'])-len(filtered)
        created = skipped = event_count = 0
        for index in range(notes):
            case_id = f'MOCK-VIS-{index+1:03}'
            if case_id in case_ids:
                skipped += 1
                continue
            encounter = ending - timedelta(days=(notes-1-index)//2)
            hour = 9 if index % 2 == 0 else 15
            systolic = 118 + round(8*math.sin(index*.5))
            diastolic = 76 + round(5*math.sin(index*.45+1))
            pulse = 78 + round(12*math.sin(index*.55))
            oxygen = 96 + index % 4
            respirations = 14 + index % 6
            temperature = round(36.5 + .4*(math.sin(index*.4)+1),1)
            narrative = (f'SYNTHETIC MOCK DATA: At {hour:02}:00 recorded blood pressure {systolic}/{diastolic}. '
                         f'At {hour:02}:01 recorded heart rate {pulse}. '
                         f'At {hour:02}:02 recorded oxygen saturation {oxygen} percent. '
                         f'At {hour:02}:03 recorded respiratory rate {respirations}. '
                         f'At {hour:02}:04 recorded temperature {temperature} celsius.')
            if index % 5 == 0:
                narrative += f' At {hour:02}:05 performed bandaging.'
            if index % 4 == 0:
                narrative += f' At {hour:02}:06 administered salbutamol by inhalation.'
            extraction = client.post('/api/extract', json={'text':narrative,'case_id':case_id,'responder_id':'MOCK-DATA-GENERATOR','encounter_date':encounter.isoformat(),'tz':'Asia/Kolkata'})
            extraction.raise_for_status(); payload = extraction.json()
            assert sum(e['event_type']=='observation' for e in payload['events']) == 5
            body = {key:payload[key] for key in ['case_id','responder_id','narrative','events','extraction_id','encounter_date','tz']}
            body.update(patient_id=patient_id, document_format='soap', record_status='pending_review')
            saved = client.post('/api/records', json=body); saved.raise_for_status()
            created += 1
            event_count += len(payload['events'])
        return {'patient_id':patient_id,'patient_name':patient['name'],'created_notes':created,'created_observations':created*5,'created_events':event_count,'skipped_existing_notes':skipped,'repaired_mock_drafts':repaired,'removed_duplicate_candidates':removed,'status':'synthetic drafts; no human review asserted'}


if __name__ == '__main__':
    import json
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8080')
    parser.add_argument('--patient-id', required=True)
    parser.add_argument('--notes', type=int, default=20, choices=range(1,101))
    parser.add_argument('--end-date')
    parser.add_argument('--repair-mock-overlaps', action='store_true', help='Append draft revisions removing legacy overlapping oxygen candidates only from this generator’s synthetic drafts')
    args = parser.parse_args()
    print(json.dumps(seed(args.url,args.patient_id,args.notes,args.end_date,args.repair_mock_overlaps),indent=2))
