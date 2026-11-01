# Synthetic text evaluation

Measured on local ASGI requests. Includes API/thread dispatch; excludes browser and speech. No independently authored wild set or real human audio has been supplied. The challenge set is hand-authored during implementation, not independent validation.

## challenge
Cases: 8 | p50/p95: 2.62/3.99 ms | traceability: 100.0% | missing-field fabrication: 0.0%

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
Cases: 200 | p50/p95: 3.78/5.81 ms | traceability: 100.0% | missing-field fabrication: 0.0%

| Field | Precision | Recall | F1 | Exact match |
|---|---:|---:|---:|---:|
| medication | 1.0 | 1.0 | 1.0 | 1.0 |
| dose | 1.0 | 1.0 | 1.0 | 1.0 |
| route | 1.0 | 1.0 | 1.0 | 1.0 |
| event_time | 1.0 | 1.0 | 1.0 | 1.0 |
| action_status | 1.0 | 1.0 | 1.0 | 1.0 |

Mismatches: 0

## held_out
Cases: 100 | p50/p95: 4.38/6.32 ms | traceability: 100.0% | missing-field fabrication: 0.0%

| Field | Precision | Recall | F1 | Exact match |
|---|---:|---:|---:|---:|
| medication | 1.0 | 1.0 | 1.0 | 1.0 |
| dose | 1.0 | 1.0 | 1.0 | 1.0 |
| route | 1.0 | 1.0 | 1.0 | 1.0 |
| event_time | 1.0 | 1.0 | 1.0 | 1.0 |
| action_status | 1.0 | 1.0 | 1.0 | 1.0 |
| observation | 1.0 | 1.0 | 1.0 | 1.0 |

Mismatches: 0
