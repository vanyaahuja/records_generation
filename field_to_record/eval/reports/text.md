# Synthetic text evaluation

Measured on local ASGI requests. Includes API/thread dispatch; excludes browser and speech. No independently authored wild set or real human audio has been supplied. The challenge set is hand-authored during implementation, not independent validation.

## challenge
Cases: 8 | p50/p95: 5.39/6.53 ms | traceability: 100.0% | missing-field fabrication: 0.0%

| Field | Precision | Recall | F1 | Exact match |
|---|---:|---:|---:|---:|
| medication | 1.0 | 1.0 | 1.0 | 1.0 |
| dose | 1.0 | 1.0 | 1.0 | 1.0 |
| route | 1.0 | 1.0 | 1.0 | 1.0 |
| event_time | 1.0 | 1.0 | 1.0 | 1.0 |
| action_status | 1.0 | 1.0 | 1.0 | 1.0 |
| observation | 1.0 | 1.0 | 1.0 | 1.0 |

Mismatches: 0

## dev
Cases: 200 | p50/p95: 5.45/6.86 ms | traceability: 100.0% | missing-field fabrication: 0.0%

| Field | Precision | Recall | F1 | Exact match |
|---|---:|---:|---:|---:|
| medication | 1.0 | 1.0 | 1.0 | 1.0 |
| dose | 1.0 | 1.0 | 1.0 | 1.0 |
| route | 1.0 | 1.0 | 1.0 | 1.0 |
| event_time | 1.0 | 1.0 | 1.0 | 1.0 |
| action_status | 1.0 | 1.0 | 1.0 | 1.0 |

Mismatches: 0

## held_out
Cases: 100 | p50/p95: 5.15/7.4 ms | traceability: 100.0% | missing-field fabrication: 0.0%

| Field | Precision | Recall | F1 | Exact match |
|---|---:|---:|---:|---:|
| medication | 1.0 | 1.0 | 1.0 | 1.0 |
| dose | 1.0 | 1.0 | 1.0 | 1.0 |
| route | 1.0 | 1.0 | 1.0 | 1.0 |
| event_time | 1.0 | 1.0 | 1.0 | 1.0 |
| action_status | 1.0 | 1.0 | 1.0 | 1.0 |
| observation | 1.0 | 1.0 | 1.0 | 1.0 |

Mismatches: 0
