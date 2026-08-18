<!-- npm run measure 가 생성한다. 손으로 고치지 말 것 -->

| 화면 | 프로파일 | 성능 | 접근성 | 권장사항 | SEO | LCP | CLS | TBT | 남은 실패 |
|---|---|---|---|---|---|---|---|---|---|
| `/dashboard` | desktop | 97 | 100 | 100 | 100 | 1.0 s | 0 | 40 ms | — |
| `/requests` | desktop | 97 | 100 | 100 | 100 | 1.1 s | 0.003 | 0 ms | — |
| `/board` | desktop | 98 | 100 | 100 | 100 | 1.1 s | 0.014 | 0 ms | — |
| `/notices` | desktop | 99 | 100 | 100 | 100 | 0.9 s | 0 | 0 ms | — |
| `/customers` | desktop | 99 | 100 | 100 | 100 | 0.8 s | 0.011 | 0 ms | — |
| `/styleguide` | desktop | 98 | 100 | 100 | 100 | 1.0 s | 0.033 | 10 ms | — |
| `/dashboard` | mobile | 52 | 100 | 100 | 100 | 6.9 s | 0.001 | 630 ms | — |
| `/requests` | mobile | 57 | 100 | 100 | 100 | 5.3 s | 0.001 | 690 ms | — |

> Lighthouse 12.8.2 · 로컬 프로덕션 빌드(`next start`) 대상.
> 성능 점수는 측정 기기에 좌우된다 — **접근성·권장사항·SEO 는 기기와 무관**하므로 그쪽이 기준이다.
> mobile 프로파일은 4배 CPU 스로틀 + 저속 4G 를 가정한다.
