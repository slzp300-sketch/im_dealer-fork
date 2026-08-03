# 아임딜러(im_dealer) 개발 워크플로우

이 프로젝트는 항상 아래 구조로 진행한다. 다른 컴퓨터에서 작업하더라도 동일하게 적용.

> **새 컴퓨터 세팅 시**: 클로드 코드가 자동으로 읽도록 이 파일을 저장소 루트에 `CLAUDE.md`로 복사해둘 것 (`CLAUDE.md`는 .gitignore에 등록되어 있어 커밋되지 않음).

## 협업 구조 (고정)

- **업스트림(메인)**: `chaneegyu1892/im_dealer` — 팀원 소유. 나(slzp300-sketch)는 읽기 권한만 있음(직접 push 불가).
- **개발 방식**: 내가 포크에서 브랜치 작업 → 업스트림에 PR → **팀원이 리뷰·머지 → 팀원이 배포**. 내가 직접 main에 머지하거나 배포하지 않는다.

## Git 리모트 구성

| 리모트 | 저장소 | 용도 |
|---|---|---|
| `origin` | `slzp300-sketch/im_dealer` | 독립 저장소(정식 포크 아님). 개인 백업/동기화용. 여기서는 교차 PR 불가 |
| `forkpr` | `slzp300-sketch/im_dealer-fork` | chaneegyu1892의 **정식 포크**. PR용 push는 반드시 여기로 |
| `upstream` | `chaneegyu1892/im_dealer` | 팀원 메인 저장소. fetch 전용(push 권한 없음) |

## PR 절차

1. `git fetch upstream` 후 `upstream/main`에서 새 브랜치를 따서 작업
2. 작업 후 `git push forkpr <branch>` (origin에 push해도 PR에는 반영 안 됨)
3. PR 생성:
   ```
   gh pr create --repo chaneegyu1892/im_dealer --base main --head slzp300-sketch:<branch> --title "..." --body-file ...
   ```
4. PR 갱신도 `git push forkpr <branch>`로.
5. 머지·배포는 팀원이 수행. 머지 후 `upstream/main`을 fetch해서 로컬을 최신화.

## 인프라 (팀원이 오너, 나는 팀 멤버)

- **DB — Supabase**: 팀 공유 프로젝트. 팀원이 메인(오너), 나는 멤버로 참여. "tenant not found" 에러가 나면 프로젝트가 pause됐을 가능성 → Restore 필요.
- **배포 — Vercel**: 팀원이 메인, 나는 팀 멤버. 배포는 팀원이 업스트림 main에 머지하면 이루어짐.
