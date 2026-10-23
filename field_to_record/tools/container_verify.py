"""Exercise the deployed HTTP and speech interfaces, including real streamed audio."""
import asyncio,json,os,time
from pathlib import Path
import httpx,numpy as np,websockets
from faster_whisper.audio import decode_audio

ROOT=Path(__file__).resolve().parents[1]
BASE=os.getenv('FTR_URL','http://127.0.0.1:8080')
async def main():
    results={}; start=time.perf_counter()
    async with httpx.AsyncClient(base_url=BASE,timeout=60) as client:
        ready=await client.get('/readyz'); ready.raise_for_status(); results['api_ready']=ready.json()
        speech=await client.get('/api/speech/status'); speech.raise_for_status(); assert speech.json()['ready']; results['speech_ready']=speech.json()
        extracted=await client.post('/api/extract',json={'text':'At 14:05 gave 5 mg fictional agent X IV. At 14:07 recorded blood pressure 120/80.'}); extracted.raise_for_status(); data=extracted.json()
        body={k:data[k] for k in ['case_id','responder_id','narrative','events','extraction_id']}; body.update(record_status='reviewed',reviewer_id='container-verification')
        assert (await client.post('/api/records',json=body)).status_code==422
        for event in body['events']: event.update(review_status='confirmed',accepted_flags=event['flags'])
        saved=await client.post('/api/records',json=body); saved.raise_for_status(); rid=saved.json()['record_id']; results['record_id']=rid
        body['expected_version']=1; body['events'][0]['dose']['value']=2
        revised=await client.put('/api/records/'+rid,json=body); revised.raise_for_status(); assert revised.json()['version']==2
        assert (await client.put('/api/records/'+rid,json=body)).status_code==409
        results['exports']={}
        for format in ['json','fhir','pdf','html','text']:
            exported=await client.get('/api/records/'+rid+'/'+format); exported.raise_for_status(); results['exports'][format]=len(exported.content)
        original=await client.get('/api/records/'+rid+'/json?version=1'); assert original.json()['record']['events'][0]['dose']['value']==5
        audit=await client.get('/api/audit/verify'); assert audit.json()['valid']; results['audit']=audit.json()
        with (ROOT/'data/audio/medication.wav').open('rb') as audio:
            transcribed=await client.post('/api/transcribe',files={'file':('synthetic.wav',audio,'audio/wav')})
        transcribed.raise_for_status(); assert 'fictional' in transcribed.json()['text'].lower()
        results['uploaded_audio']={key:transcribed.json()[key] for key in ['text','model','inference_ms','rtf']}
    pcm=(np.clip(decode_audio(str(ROOT/'data/audio/medication.wav')),-1,1)*32767).astype('<i2').tobytes()+bytes(32000)
    messages=[]; ws_url=BASE.replace('http://','ws://').replace('https://','wss://')+'/api/live'
    async with websockets.connect(ws_url,origin=BASE,max_size=2**22) as ws:
        while json.loads(await ws.recv())['type']!='ready': pass
        started=time.perf_counter()
        async def feed():
            for index in range(0,len(pcm),3200):
                await ws.send(pcm[index:index+3200]); await asyncio.sleep(.1)
            await ws.send('stop')
        sender=asyncio.create_task(feed())
        async for message in ws:
            decoded=json.loads(message); decoded['elapsed_ms']=round((time.perf_counter()-started)*1000,2); messages.append(decoded)
            if decoded['type']=='complete': break
        await sender
    assert any(m['type']=='partial' and m.get('text') for m in messages)
    assert any(m['type']=='final' and any(e.get('medication')=='fictional agent x' for e in m.get('events',[])) for m in messages)
    results['stream']={'first_nonempty_partial_ms':next(m['elapsed_ms'] for m in messages if m['type']=='partial' and m.get('text')),'final_transcript':next(m['transcript'] for m in messages if m['type']=='complete')}
    results['elapsed_seconds']=round(time.perf_counter()-start,2)
    directory=ROOT/'eval/reports'; directory.mkdir(exist_ok=True)
    (directory/'containers.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
    print(json.dumps(results,indent=2))
if __name__=='__main__': asyncio.run(main())
