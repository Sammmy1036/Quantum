// Quantum UI: Missions (Home > Missions): who hands out contracts, the factions behind them and what each offers.
// One of several classic scripts sharing one global scope; index.html loads them in order.
// Every top-level name here starts with "mi" so it can't clash with the other scripts.
"use strict";
// The list of employers comes from Quantum's own game data (contracts_data.json), or the Star Citizen Wiki's
// mission list until that's on this PC. A faction's overview (headquarters, leadership, reputation ranks) is
// looked up on the wiki when you open it. A contract opens in place: its briefing, then where it's offered.
S.mi=S.mi||{data:null,loading:null,q:"",law:"",type:"",sel:null,open:null,fac:{},page:{}};
const miN=x=>Number(x).toLocaleString();
const miPay=(a,b,cur)=>a==null&&b==null?"":`${a!=null&&b!=null&&a!==b?`${miN(a)}–${miN(b)}`:miN(b??a)} ${cur&&cur!=="UEC"?cur:"aUEC"}`;
const miKey=e=>e.name.toLowerCase();
// An employer's logo: its own (Covalex, Hurston Dynamics, Crusader Security…), else its faction's, from the Star
// Citizen Wiki (looked up once, the misses asked about again after a month); its initials until one is found
// Employers the wiki has no logo for get one for the kind of work they give: bounties the self-destruct
// icon, local contractors the crew icon, delivery and hauling the hauler, protection and security the shield
const MI_KIND_ICON={
  bounty:"data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbDpzcGFjZT0icHJlc2VydmUiIGlkPSJMYXllcl8xIiB4PSIwIiB5PSIwIiBzdHlsZT0iZW5hYmxlLWJhY2tncm91bmQ6bmV3IDAgMCA1MCA1MCIgdmVyc2lvbj0iMS4xIiB2aWV3Qm94PSIwIDAgNTAgNTAiPgoJPHBhdGggZD0ibTQzIDMyLjEtOC4zIDUuNC02LjEtMi42LjEtNS40IDEyLjUtMi45IDIuMS0uNy0xLjEtNi44LTEuMy0uMSAxLjYtMTAtLjEtMS40Yy0yLjYtMi44LTUuNS01LjEtOC40LTZDMzAuMS4zIDI1IDAgMjUgMHMtNS4xLjMtOC45IDEuNmMtMi45LjktNS43IDMuMi04LjQgNkw3LjYgOWwxLjYgMTAtMS41LjEtMSA2LjggMiAuOCAxMi41IDIuOS4xIDUuNC02LjEgMi42TDcgMzIuMmwtMS40IDQuOSA2LjEgNi44IDQgMS4xIDMgNC45aDEyLjZsMy00LjkgNC0xLjEgNi4xLTYuOC0xLjQtNXpNMjguNCA0M2gtNi45bC0uOC0xLjggMi4zLTMuOWg0bDIuMyAzLjktLjkgMS44eiIvPgo8L3N2Zz4K",
  hauler:"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGZpbGw9Im5vbmUiIHZpZXdCb3g9IjAgMCAxNiAxNiI+PHBhdGggZmlsbD0iY3VycmVudENvbG9yIiBkPSJNMSAxMC40OTVjMC0uMjguMTk1LS4zOTMuNDM2LS4yNTNsMS44MjMgMS4wNjFjLjI0LjE0LjQzNi40OC40MzYuNzZ2Mi4xMjNjMCAuMjgtLjE5NS4zOTQtLjQzNi4yNTRsLTEuODIzLTEuMDYxQS45Ny45NyAwIDAgMSAxIDEyLjYxOHptNi0uMjUzYy4yNDEtLjE0LjQzNi0uMDI3LjQzNi4yNTN2Mi4xMjNjMCAuMjgtLjE5NS42Mi0uNDM1Ljc2TDUuMTc3IDE0LjQ0Yy0uMjQuMTQtLjQzNS4wMjctLjQzNS0uMjU0di0yLjEyMmMwLS4yOC4xOTUtLjYyLjQzNS0uNzZ6bTEuNTY0LjI1M2MwLS4yOC4xOTUtLjM5My40MzUtLjI1M2wxLjgyNCAxLjA2MWMuMjQuMTQuNDM1LjQ4LjQzNS43NnYyLjEyM2MwIC4yOC0uMTk1LjM5NC0uNDM1LjI1NGwtMS44MjQtMS4wNjFhLjk3Ljk3IDAgMCAxLS40MzYtLjc2MXptNi0uMjUzYy4yNC0uMTQuNDM2LS4wMjcuNDM2LjI1M3YyLjEyM2EuOTcuOTcgMCAwIDEtLjQzNi43NmwtMS44MjMgMS4wNjJjLS4yNC4xNC0uNDM2LjAyNy0uNDM2LS4yNTR2LTIuMTIyYzAtLjI4LjE5NS0uNjIuNDM2LS43NnptLTEwLjc4OC0yLjNhMS4wNSAxLjA1IDAgMCAxIC44ODkgMGwxLjg1OS45OTdjLjI0NS4xMzEuMjQ1LjM0NCAwIC40NzZsLTEuODYuOTk2YTEuMDUgMS4wNSAwIDAgMS0uODg4IDBsLTEuODU5LS45OTZjLS4yNDUtLjEzMi0uMjQ1LS4zNDUgMC0uNDc2em03LjU2NCAwYTEuMDUgMS4wNSAwIDAgMSAuODg4IDBsMS44Ni45OTdjLjI0NS4xMzEuMjQ1LjM0NCAwIC40NzZsLTEuODYuOTk2YTEuMDUgMS4wNSAwIDAgMS0uODg4IDBsLTEuODYtLjk5NmMtLjI0NS0uMTMyLS4yNDUtLjM0NSAwLS40NzZ6bS02LjUxMy0zLjc5YzAtLjI4LjE5NS0uMzk0LjQzNS0uMjU0TDcuMDg2IDQuOTZjLjI0LjE0LjQzNi40ODEuNDM2Ljc2MXYyLjEyM2MwIC4yOC0uMTk1LjM5My0uNDM2LjI1M0w1LjI2MiA3LjAzNWEuOTcuOTcgMCAwIDEtLjQzNS0uNzZ6bTYuMDAxLS4yNTRjLjI0LS4xNC40MzUtLjAyNi40MzUuMjU0djIuMTIyYzAgLjI4LS4xOTUuNjIxLS40MzUuNzYxTDkuMDA0IDguMDk2Yy0uMjQuMTQtLjQzNi4wMjctLjQzNi0uMjUzVjUuNzJjMC0uMjguMTk1LS42Mi40MzYtLjc2ek03LjYwMyAxLjU5OWExLjA1IDEuMDUgMCAwIDEgLjg4OCAwbDEuODYuOTk2Yy4yNDUuMTMyLjI0NS4zNDUgMCAuNDc2bC0xLjg2Ljk5N2ExLjA1IDEuMDUgMCAwIDEtLjg4OCAwbC0xLjg2LS45OTdjLS4yNDUtLjEzMS0uMjQ1LS4zNDQgMC0uNDc2eiIvPjwvc3ZnPg==",
  shield:"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGZpbGw9Im5vbmUiIHZpZXdCb3g9IjAgMCAxNiAxNiI+PHBhdGggZmlsbD0iY3VycmVudENvbG9yIiBkPSJNMTMuNDc0IDEyLjA2MmEuMy4zIDAgMCAxLS4yMDUtLjA3N2MtLjE4LS4xMjgtLjIzLS4zNTctLjEwMy0uNTM3YTYuMiA2LjIgMCAwIDAgMS4wNDctMy40NzUgNi4yIDYuMiAwIDAgMC0xLjA0Ny0zLjQ3NWMtLjEyNy0uMTgtLjA3Ny0uNDEuMTAzLS41MzdzLjQxLS4wNzguNTM3LjEwMmE2Ljk0IDYuOTQgMCAwIDEgMS4xNzcgMy44ODVjMCAxLjQwNi0uNDEgMi43Ni0xLjE3NyAzLjg4NC0uMTAyLjE4LS4yMDUuMjMtLjMzMi4yM20tMTAuOTkzIDBhLjM3LjM3IDAgMCAxLS4zMDctLjE1MkE2LjkgNi45IDAgMCAxIDEgOC4wMjNjMC0xLjQwNy40MS0yLjc2MSAxLjE3Ny0zLjg4NS4xMjctLjE4LjM1Ny0uMjA1LjUzNy0uMTAzLjE4LjEyOC4yMy4zNTguMTAyLjUzOC0uNzE0Ljk5Ni0xLjA3NCAyLjE3My0xLjA3NCAzLjQ1IDAgMS4yNzYuMzU3IDIuNDUzIDEuMDQ3IDMuNDc0LjEyNy4xOC4wNzcuNDEtLjEwMy41MzgtLjA1IDAtLjEyNy4wMjQtLjIwNS4wMjR6bTkuMTc2LTkuMTc2YS4zLjMgMCAwIDEtLjIwNS0uMDc3Yy0yLjAxOC0xLjM4LTQuOTA2LTEuMzgtNi45MjcgMC0uMTguMTI3LS40MS4wNzctLjUzNy0uMTAzcy0uMDc4LS40MS4xMDItLjUzN0M2LjM2Ni42MSA5LjU4Ni42MSAxMS44NiAyLjE3Yy4xOC4xMjguMjMuMzU3LjEwMi41MzdhLjM0LjM0IDAgMCAxLS4zMDcuMTh6TTcuOTc4IDE1YTYuOSA2LjkgMCAwIDEtMy44ODUtMS4xNzdjLS4xOC0uMTI3LS4yMy0uMzU3LS4xMDMtLjUzNy4xMjgtLjE4LjM1OC0uMjMuNTM4LS4xMDIgMi4wMTggMS4zNzkgNC45MDYgMS4zNzkgNi45MjcgMCAuMTgtLjEyOC40MS0uMDc4LjUzNy4xMDJzLjA3OC40MS0uMTAyLjUzN0E3LjAzIDcuMDMgMCAwIDEgNy45OCAxNXptMi43MzUtOS41MDhMOC4yNiA0LjQ3bC0uMjgyLS4xMjctLjI4My4xMjctMi40NTMgMS4wMjItLjQ2LjE4djIuMzI2YzAgMS4yNTEuNjE1IDIuNDAzIDEuNjM3IDMuMDkybDEuMTQ5Ljc2Ny40MS4yODMuNDEtLjI4MyAxLjEyMy0uNzY3YTMuNzIgMy43MiAwIDAgMCAxLjYzNy0zLjA5MlY1LjY3MnptLS4yODIgMi41MDZjMCAuOTk2LS40ODUgMS45MTYtMS4zMyAyLjQ3OGwtMS4xMjQuNzY3VjUuMTM1bDIuNDU0IDEuMDIxeiIvPjwvc3ZnPg==",
  exploration:"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGZpbGw9Im5vbmUiIHZpZXdCb3g9IjAgMCAxNiAxNiI+PHBhdGggZmlsbD0iY3VycmVudENvbG9yIiBkPSJNOC40MTYgMy45N1YxYy4zNy4wNTguNzc3LjI1NiAxLjEzMi41NTUuNTY3LjQ3OCAxLjAxNiAxLjExMSAxLjQxNCAxLjk5Ni4wNTMuMTE2LjEuMjMzLjE1MS4zNTlsLjAyNS4wNnptNC4yNTQgMy42MzMtLjAzNC0uMzg3Yy0uMDMtLjM1NC0uMDU4LS42OS0uMTA3LTEuMDI4LS4wNS0uMzQ1LS4xMjQtLjY5Mi0uMTk2LTEuMDI4LS4wMjctLjEyLS4wNDgtLjIyNC0uMDc0LS4zNDZoMS45NzJjLjAxOCAwIC4wNS4wMjMuMDYuMDQ0LjQ1Ni45MTYuNjg4IDEuNzk5LjcwOSAyLjY5OXEwIC4wMzctLjAwMi4wNDZsLS4wMzcuMDAzYy0uNDI4LS4wMDMtMi4yOS0uMDAzLTIuMjktLjAwM3ptLS4zNCAzLjIzM2MuMDczLS4zMzYuMTQ3LS42ODMuMTk3LTEuMDI3LjA1MS0uMzQuMDgtLjY3NC4xMDctMS4wMjhsLjAzNC0uMzg3czEuODYyIDAgMi4yODYtLjAwNHEuMDMzLS4wMDEuMDQuMDA0YzAgLjAwNy4wMDQuMDE5LjAwMi4wNDYtLjAyLjktLjI1MiAxLjc4My0uNzA5IDIuNjk5YS4xNC4xNCAwIDAgMS0uMDYzLjA1M2MtLjU5My4wMDctMS45NzIuMDA5LTEuOTcyLjAwOXEuMDM2LS4xODMuMDc3LS4zNjN6bS0xLjE5MiAxLjE5Mi0uMDI1LjA2cS0uMDczLjE4NS0uMTUuMzZjLS40Ljg4NC0uODQ4IDEuNTE3LTEuNDE1IDEuOTk1LS4zNTUuMjk5LS43NjIuNDk3LTEuMTMyLjU1NXYtMi45N3ptLjMxNy0uOWMtLjAyLjA3NC0uMTIuMDczLS4xMi4wNzMtLjc4OS0uMDA2LTIuODg4IDAtMi45MTcgMC0uMDA3LS4wMjMtLjAwNy0yLjc5Mi0uMDA3LTIuNzkyaDMuNDIyYy0uMDUxIDEuMDgzLS4xNjkgMS45NDgtLjM3OCAyLjcybS0zLjAzNC02LjMxczIuMTI3LjAwNCAyLjkxNyAwYy4wOCAwIC4wOTYuMDExLjExNy4wODguMjEuNzcuMzI3IDEuNjA0LjM3NyAyLjY4NmgtMy40MmwuMDA3LTIuNzY4em0zLjY1NC0uODQzYy0uMDc2IDAtLjA5MS0uMDEtLjExMy0uMDg1LS4xODctLjY0LS41MDgtMS4yNjQtLjk4Mi0xLjkxMi0uMTM0LS4xODItLjI3OC0uMzYtLjQxNi0uNTM0IDEuMjg4LjUwNiAyLjM0NiAxLjMzNSAzLjIyIDIuNTI4em0tMS41MTEgMTAuNTgxYy4xMzgtLjE3My4yODItLjM1Mi40MTYtLjUzNC40NzMtLjY0OC43OTUtMS4yNzIuOTgyLTEuOTEyLjAyMS0uMDczLjAzNi0uMDguMTEzLS4wOGgxLjcwOWMtLjg3NCAxLjE5Mi0xLjkzMiAyLjAyMi0zLjIyIDIuNTI2bS0yLjk4LTIuNTI2VjE1Yy0uMzctLjA1OC0uNzc3LS4yNTctMS4xMzItLjU1NS0uNTY3LS40NzgtMS4wMTYtMS4xMTEtMS40MTQtMS45OTZhMTAgMTAgMCAwIDEtLjE1MS0uMzU5bC0uMDI1LS4wNnpNNC44NjIgMy45NzJsLjAyNS0uMDZxLjA3NC0uMTg1LjE1LS4zNmMuNC0uODg0Ljg0OC0xLjUxNyAxLjQxNS0xLjk5NS4zNTUtLjI5OS43NjItLjQ5NyAxLjEzMi0uNTU1djIuOTd6bS0uMzE3LjkzNGMuMDItLjA3NS4wMzctLjA4OS4xMTQtLjA4OWgyLjkycy4wMDkgMCAuMDA5LjAwN3YyLjc2OEg0LjE2NmMuMDUtMS4wODIuMTY4LTEuOTE1LjM3Ny0yLjY4NnptLjEyIDYuMjk1Yy0uMDc4IDAtLjA5Ni0uMDEzLS4xMTUtLjA4OS0uMjA5LS43NzEtLjMzMi0xLjYyLS4zODMtMi43MDRINy41OXYyLjc3NXMtLjAwMy4wMTgtLjAxNy4wMTh6bS4zNTQtOS4yMjNjLS40NzQuNjQ4LS43OTUgMS4yNzItLjk4MyAxLjkxMi0uMDIxLjA3My0uMDM3LjA4NS0uMTEyLjA4NWgtLjAwNmwtMS43MDQtLjAwM2MuODc0LTEuMTkzIDEuOTMyLTIuMDIyIDMuMjItMi41MjgtLjEzOC4xNzMtLjI4Mi4zNTItLjQxNS41MzRtLTEuMSAxMC4wNDdoLjAwNWMuMDc1IDAgLjA5LjAxLjExMi4wODMuMTg4LjY0LjUwOSAxLjI2NS45ODMgMS45MTIuMTMzLjE4Mi4yNzcuMzYuNDE1LjUzNC0xLjI4OC0uNTA2LTIuMzQ2LTEuMzM1LTMuMjItMi41MjdsMS43MDQtLjAwNHpNMS4wMDQgNy41OXEtLjAwMS4wMDEtLjAwMy0uMDA0YzAtLjAwNy0uMDAyLS4wMDQgMC0uMDI4LjAyLS45LjI1Mi0xLjc4My43MDktMi43LjAxLS4wMi4wMjYtLjA0NC4wNjMtLjA0NGgxLjk2OWwtLjA3NC4zNDdjLS4wNzIuMzM2LS4xNDYuNjgzLS4xOTYgMS4wMjgtLjA1MS4zNC0uMDguNjc0LS4xMDcgMS4wMjctLjAxMS4xMjgtLjAyMy4yNC0uMDM2LjM3bC0yLjMyMy4wMDR6bS0uMDAxLjgwNHMuMDE3LS4wMDMuMDM2LS4wMDNsMi4yOS4wMDNjLjAwNi4yNTUuMDkyIDEuMDc2LjE0IDEuNDE1LjA1Mi4zNDMuMTI1LjY5Mi4xOTcgMS4wMjhsLjA3OC4zNjMtMS45NzUtLjAxYy0uMDIyIDAtLjA1LS4wMzEtLjA2MS0uMDUyLS40NTYtLjkxNi0uNjg4LTEuOC0uNzA5LTIuN3EwLS4wMzUuMDAyLS4wNDV6Ii8+PC9zdmc+",
  crew:"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGZpbGw9Im5vbmUiIHZpZXdCb3g9IjAgMCAxNiAxNiI+PHBhdGggZmlsbD0iY3VycmVudENvbG9yIiBkPSJNOC4wMzcgNy4yNjljLTEuMTYzIDAtMi4xMDYtLjk1Ni0yLjEwNi0yLjEzNUM1LjkzIDMuOTU2IDYuODc0IDMgOC4wMzcgM3MyLjEwNi45NTYgMi4xMDYgMi4xMzRjMCAxLjE4LS45NDMgMi4xMzUtMi4xMDYgMi4xMzVtLTMuNTIxIDUuMzk2Yy4wMjEuMTkuMTguMzM1LjM3LjMzNWg2LjI3OGMuMTkgMCAuMzQ5LS4xNDQuMzctLjMzNWwuMjE0LTEuOTN2LS42NjVhLjc2Ljc2IDAgMCAwLS40MTItLjY3NWwtMS43NDMtLjg4M2EuNC40IDAgMCAwLS4xNjctLjA0SDYuNjI0YS40LjQgMCAwIDAtLjE2Ny4wNGwtMS43NDMuODgzYS43Ni43NiAwIDAgMC0uNDEyLjY3NXYuNjY2ek0yLjU2NSAxMC4wN2MwLS44MTguMzkxLTEuNTc2IDEuMDM0LTIuMDQ0aC0xcS0uMDYxIDAtLjExNS4wMjhsLTEuMi42MDhBLjUyLjUyIDAgMCAwIDEgOS4xMjd2LjQ1OGwuMTQ3IDEuMzI4YS4yNi4yNiAwIDAgMCAuMjU1LjIzMUgyLjZsLS4wMzQtMS4wNzRabTEuNjI4LTQuOTM2cTAtLjM2LjA2My0uNzAxYTEuNCAxLjQgMCAwIDAtLjY4NS0uMTc0Yy0uOCAwLTEuNDUuNjU4LTEuNDUgMS40N3MuNjUgMS40NyAxLjQ1IDEuNDdjLjM4MyAwIC43MzItLjE1MS45OTEtLjM5N2EzLjkgMy45IDAgMCAxLS4zNjktMS42NjhtNy42ODcgMGMwIC42MTEtLjEzOSAxLjE5LS4zODYgMS43MDQuMjU1LjIyNC41ODcuMzYuOTUuMzZhMS40NiAxLjQ2IDAgMCAwIDEuNDUtMS40NyAxLjQ2IDEuNDYgMCAwIDAtMS40NS0xLjQ2OWMtLjIyNiAwLS40NC4wNTMtLjYzMS4xNDdxLjA2Ni4zNTUuMDY3LjcyOG0xLjU3MSA2LjAxaDEuMTQ3Yy4xMyAwIC4yNC0uMS4yNTUtLjIzTDE1IDkuNTg0di0uNDU4YS41Mi41MiAwIDAgMC0uMjgzLS40NjVsLTEuMi0uNjA4YS4yNS4yNSAwIDAgMC0uMTE1LS4wMjhoLS45NTFhMi41MyAyLjUzIDAgMCAxIDEuMDM1IDIuMDQ0bC0uMDM1IDEuMDc0WiIvPjwvc3ZnPg=="};
// Named people who give contracts, by the icon that fits their work
const MI_PERSON_ICON=[[/tecia\s*pacheco/i,"bounty"],[/clov[iu]s\s*darneely/i,"exploration"],[/miles\s*eckhart/i,"shield"],[/jo\s*jangl?es/i,"shield"],[/bount/i,"bounty"],[/^microtech\b/i,"shield"],[/how\s*to\s*play/i,"exploration"]];
function miKindIcon(e){ const n=e.name.toLowerCase(), t=(e.types||[]).map(x=>String(x).toLowerCase()), top=t[0]||"";
  if(/^local contractors$/.test(n)) return MI_KIND_ICON.crew;
  if(/bount/.test(n)||/bount/.test(top)) return MI_KIND_ICON.bounty;
  const deliv=x=>/deliver|haul|courier|cargo|freight|transport/.test(x), prot=x=>/protect|secur|defen|escort|guard|patrol/.test(x);
  if(deliv(top)) return MI_KIND_ICON.hauler; if(prot(top)||prot(n)) return MI_KIND_ICON.shield;
  if(t.some(deliv)||deliv(n)) return MI_KIND_ICON.hauler; if(t.some(prot)) return MI_KIND_ICON.shield;
  if(t.some(x=>/bount/.test(x))) return MI_KIND_ICON.bounty;
  return /contractor/.test(n)?MI_KIND_ICON.crew:null; }
const miLogo=e=>{ const who=MI_PERSON_ICON.find(([rx])=>rx.test(e.name)); return who?MI_KIND_ICON[who[1]]:miLogo0(e); };
const miLogo0=e=>(/bount/i.test(e.name)?MI_KIND_ICON.bounty:null)||makerLogo(e.name)||(e.faction?makerLogo(e.faction):null)||miKindIcon(e);
const miInit=e=>esc((e.name.match(/[A-Z0-9]/g)||[e.name[0]]).slice(0,2).join(""));
const miLaw=e=>e.unlawful&&!e.lawful?"bad":e.unlawful?"mix":"";
const miSmallLogo=e=>/hurston dynamics/i.test(`${e.name} ${e.faction||""}`);       // a thin wordmark: drawn larger
const miIcon=(e,big)=>{ const u=miLogo(e);
  return u?`<span class="ic logo${big?" big":""}${miSmallLogo(e)?" x3":""}" title="${esc(e.faction&&e.faction!==e.name?`${e.name} · ${e.faction}`:e.name)}"><i class="brand-ic" style="-webkit-mask-image:url('${u}');mask-image:url('${u}')" aria-hidden="true"></i></span>`
    :`<span class="ic ${miLaw(e)}${big?" big":""}">${miInit(e)}</span>`; };
async function miLogos(){ const d=S.mi.data; if(!d?.ok||S.mi.logosAsked) return; S.mi.logosAsked=true;
  if(!S.brands||Object.keys(S.brands).length<=Object.keys(LOCAL_BRANDS).length){ S.mi.logosAsked=false; loadBrands(()=>miLogos()); if(S.brands===undefined) return; S.mi.logosAsked=true; }
  const seen=new Set(), want=[];
  for(const e of d.employers) for(const n of [e.name,e.faction]){ if(!n||/^(local contractors|bounty issuers|unknown employer)$/i.test(n)) continue;
    const k=n.toLowerCase(); if(seen.has(k)||makerLogo(n)) continue; seen.add(k); want.push({name:n.replace(/ bounties$/i,""),code:""}); }
  for(let k=0;k<want.length;k+=25){ let r; try{ r=await api().maker_logos(want.slice(k,k+25)); }catch(_){ r=null; }
    const got=r?.logos||{}; if(Object.keys(got).length){ S.brands={...(S.brands||{}),...got}; if(S.tab==="missions"){ miRenderList(); miRender(); } } } }
// The wiki's rank names are the game's keys ("Delivery_Rank3", "Delivery_NotEligible"): shown readably
const miRankName=n=>{ const s=String(n); let m=s.match(/^(?:[A-Za-z]+_)?Rank_?(\d+)$/i); if(m) return `Rank ${m[1]}`;
  if(/NotEligible$/i.test(s)) return "Not eligible"; return s.replace(/_/g," "); };

function miLoad(){ if(S.mi.loading) return S.mi.loading;
  return S.mi.loading=api().missions_index().then(r=>{ S.mi.data=r; return r; })
    .catch(()=>{ S.mi.data={ok:false,error:"Couldn't load the missions"}; }).finally(()=>{ S.mi.loading=null; }); }

async function openMissions(){
  if(!S.mi.data){ $("mi-list").innerHTML=`<div class="muted" style="padding:10px 4px">Loading employers…</div>`;
    $("mi-panel").innerHTML=qLoader("Gathering every employer and their contracts…"); await miLoad(); if(S.tab!=="missions") return; }
  miFilters(); miRenderList(); miRender(); miLogos(); }

function miShown(){ const d=S.mi.data; if(!d?.ok) return [];
  const q=S.mi.q.trim().toLowerCase();
  return d.employers.filter(e=>(!S.mi.law||(S.mi.law==="lawful"?e.lawful:e.unlawful))
    &&(!S.mi.type||e.types.includes(S.mi.type))
    &&(!q||`${e.name} ${e.faction||""} ${e.types.join(" ")}`.toLowerCase().includes(q)||e.missions.some(m=>m.title.toLowerCase().includes(q)))); }

function miFilters(){ const d=S.mi.data, sel=$("mi-type"); if(!d?.ok||!sel||sel.dataset.done) return; sel.dataset.done=1;
  const types=[...new Set(d.employers.flatMap(e=>e.types))].sort();
  sel.innerHTML=`<option value="">All kinds of work</option>${types.map(t=>`<option>${esc(t)}</option>`).join("")}`; }

function miRenderList(){ const L=$("mi-list"), d=S.mi.data; if(!L) return;
  if(!d?.ok){ L.innerHTML=`<div class="empty"><strong>Couldn't load the missions</strong>${esc(d?.error||"")}<br><br><button class="btn small" id="mi-retry">Try again</button></div>`;
    $("mi-retry").onclick=()=>{ S.mi.data=null; openMissions(); }; return; }
  const rows=miShown();
  $("c-missions").textContent=d.employers.length;
  L.innerHTML=rows.length?rows.map(e=>`<button class="mi-emp${S.mi.sel===miKey(e)?" on":""}" data-mi="${esc(miKey(e))}">
      ${miIcon(e)}
      <span class="t"><b>${esc(e.name)}</b><small>${esc([e.faction&&e.faction.toLowerCase()!==e.name.toLowerCase()?e.faction:"",`${e.count} contract${e.count>1?"s":""}`].filter(Boolean).join(" · "))}</small></span>
      <span class="law ${e.unlawful&&!e.lawful?"bad":e.unlawful?"mix":"ok"}" title="${e.lawful} lawful, ${e.unlawful} unlawful">${e.unlawful&&!e.lawful?"Unlawful":e.unlawful?"Mixed":"Lawful"}</span></button>`).join("")
    :`<div class="empty"><strong>No employers match</strong>Try another search or filter.</div>`;
  L.onclick=e=>{ const b=e.target.closest("[data-mi]"); if(!b) return; S.mi.sel=b.dataset.mi; S.mi.open=null; $("mi-panel").scrollTop=0; miRenderList(); miRender(); }; }

function miRender(){ const P=$("mi-panel"), d=S.mi.data; if(!P||!d) return;
  if(!d.ok){ P.innerHTML=`<div class="empty" style="margin-top:60px"><strong>Missions</strong>${esc(d.error||"")}</div>`; return; }
  const e=d.employers.find(x=>miKey(x)===S.mi.sel);
  if(!e) return miOverview(P,d);
  const fname=e.faction||e.name, fac=S.mi.fac[fname];
  if(fac===undefined){ S.mi.fac[fname]=null; api().faction_info(fname).then(r=>{ S.mi.fac[fname]=r.ok?(r.found?r.faction:false):{error:r.error};
    if(S.tab==="missions"&&S.mi.sel===miKey(e)) miRender(); }).catch(()=>{ S.mi.fac[fname]={error:"Couldn't look it up"}; }); }
  const byType={}; for(const m of e.missions) (byType[m.type||"Other"]=byType[m.type||"Other"]||[]).push(m);
  const about=fac===null||fac===undefined?`<div class="muted" style="font-size:13px;padding:8px 0">Looking up ${esc(fname)} on the Star Citizen Wiki…</div>`
    :fac===false?`<div class="muted" style="font-size:13px;padding:8px 0">The Star Citizen Wiki has no page on ${esc(fname)} yet.</div>`
    :fac.error?`<div class="muted" style="font-size:13px;padding:8px 0">${esc(fac.error)} <a class="mi-link" data-mifretry="${esc(fname)}">Try again</a></div>`
    :`${fac.overview?.length?`<div class="mi-kv">${fac.overview.map(([k,v])=>`<span>${esc(k)}</span><b>${esc(v)}</b>`).join("")}</div>`:""}
      ${fac.description?`<p class="gr-desc mi-text" style="margin:10px 0 4px">${esc(fac.description)}</p>`:""}`;
  const ranks=fac&&!fac.error&&fac.ranks?.length?`<div class="vd-sec"><div class="mk-h">Reputation ranks</div><div class="mi-ranks">${fac.ranks.map(([n,x],i)=>`<div><span class="n">${i+1}</span><b title="${esc(n)}">${esc(miRankName(n))}</b><small>${x==null?"":x<0?"Hostile":miN(x)+" rep"}</small></div>`).join("")}</div></div>`:"";
  const logo=miLogo(e);
  P.innerHTML=`<div class="mi-head${logo?` has-logo${miSmallLogo(e)?" x3":""}`:""}">${logo?"":`<div class="ic big ${miLaw(e)}">${miInit(e)}</div>`}
      <div style="min-width:0"><h2>${esc(e.name)}</h2><div class="sub">${esc([e.faction&&e.faction.toLowerCase()!==e.name.toLowerCase().replace(/ bounties$/,"")?e.faction:"Employer",...e.types.slice(0,4)].join(" · "))}</div>
        ${e.note?`<div class="muted mi-note">${esc(e.note)}</div>`:""}</div>
      <div class="mi-head-r">${fac?.url?`<button class="btn ghost small" data-ext="${esc(fac.url)}">Wiki</button>`:""}${logo?`<span class="hd-logo mi-logo${miSmallLogo(e)?" x3":""}" title="${esc(e.faction&&e.faction!==e.name?`${e.name} · ${e.faction}`:e.name)}"><i class="brand-ic" style="-webkit-mask-image:url('${logo}');mask-image:url('${logo}')" aria-hidden="true"></i></span>`:""}</div></div>
    ${statBlock([{label:"Contracts",value:String(e.count)},{label:"Pays",value:e.reward[1]!=null?miPay(e.reward[0],e.reward[1]):null}],
      [{label:"Lawful",value:String(e.lawful)},{label:"Unlawful",value:String(e.unlawful)},{label:"Kinds of work",value:String(e.types.length||1)}])}
    <div class="vd-grid vd-flat bp-grid" style="margin-top:14px">
      <div class="vd-sec" style="grid-column:1/-1"><div class="mk-h">About ${esc(fname)}</div>${about}</div>${ranks}</div>
    ${Object.entries(byType).map(([t,L])=>`<div class="mk-h" style="margin-top:18px">${esc(t)} <span class="muted" style="letter-spacing:0">${L.length}</span></div>${L.map(m=>miRow(e,m)).join("")}`).join("")}
    <div class="uex-credit">${d.source==="game"?"Contracts from the game files (Quantum's game data); faction details from the Star Citizen Wiki.":"From the Star Citizen Wiki's mission data."}</div>`; }

function miRow(e,m){ const id=`${miKey(e)}|${m.code||m.ref||m.title}`, open=S.mi.open===id;
  const meta=[m.rank!=null&&m.rank!==""?(typeof m.rank==="number"?`Rank ${m.rank}`:m.rank):"",m.rep?`+${miN(m.rep)} rep`:"",m.lawful===false?"Unlawful":"",m.max_players>1?`Up to ${m.max_players} players`:""].filter(Boolean);
  return `<div class="mi-row${open?" open":""}" data-mirow="${esc(id)}"><button class="h" data-mitoggle="${esc(id)}"><span class="w"><b>${esc(m.title)}</b>${meta.length?`<small>${esc(meta.join(" · "))}</small>`:""}</span>
      <span class="p">${esc(miPay(m.reward,m.reward_max,m.currency))}</span><span class="chev">${open?"▾":"▸"}</span></button>
    ${open?`<div class="b">${m.desc?`<p class="mi-text">${esc(m.desc)}</p>`:""}${m.cargo?.length?`<div class="muted" style="font-size:12.5px;margin:4px 0">Cargo: ${esc(m.cargo.join(", "))}</div>`:""}
      <div>${miPageHtml(id,!!m.desc)}</div></div>`:""}</div>`; }

// The wiki's page for a contract, opened under its row: where it's offered (one click to the route), the briefing
function miPageHtml(id,hasDesc){ const p=S.mi.page[id];
  if(p===undefined) return `<button class="btn small" data-mipage="${esc(id)}">Where it's offered and more</button>`;
  if(p===null) return `<div class="muted" style="font-size:12.5px">Looking it up on the Star Citizen Wiki…</div>`;
  if(p.error) return `<div class="muted" style="font-size:12.5px">${esc(p.error)} <a class="mi-link" data-mipage="${esc(id)}">Try again</a></div>`;
  if(p.missing) return `<div class="muted" style="font-size:12.5px">The Star Citizen Wiki doesn't have this one yet.</div>`;
  const rows=p.offered_at_rows||[], there=[...(p.pickups_rows||[]),...(p.destinations_rows||[])];
  const place=x=>`<div class="mk-row"><div class="w">${x.place?`<a data-open="${esc(x.place)}">${esc(x.name)}</a>`:esc(x.name)}</div><div class="p"></div>
      ${x.place?`<button class="iconbtn${S.live?.route?.includes(x.place)?" added":""}" data-miadd="${esc(x.place)}" title="Add ${esc(x.place)} to your route">${S.live?.route?.includes(x.place)?"✓":"+"}</button>`:"<span></span>"}
      <div class="m">${x.body?esc(x.body):x.place?"":"Not on Quantum's map yet"}</div></div>`;
  return `${!rows.length&&!there.length&&!p.description?`<div class="muted" style="font-size:12.5px">The wiki doesn't say where it's offered.</div>`:""}
    ${p.description&&!hasDesc?`<p class="mi-text" style="opacity:.85">${esc(p.description)}</p>`:""}
    <div class="vd-grid bp-grid" style="margin-top:6px">${rows.length?`<div><div class="mk-h">Where it's offered</div>${rows.map(place).join("")}${p.offered_at?.more?`<div class="muted" style="font-size:12px">+${p.offered_at.more} more</div>`:""}</div>`:""}
      ${there.length?`<div><div class="mk-h">Where it sends you</div>${there.map(place).join("")}</div>`:""}</div>
    ${p.url?`<button class="btn ghost small" data-ext="${esc(p.url)}" style="margin-top:6px">Open on the wiki</button>`:""}`; }

// No employer picked: the biggest ones, and how the work splits up
function miOverview(P,d){ const E=d.employers, law=E.reduce((a,e)=>a+e.lawful,0), un=E.reduce((a,e)=>a+e.unlawful,0);
  const types={}; for(const e of E) for(const m of e.missions) types[m.type||"Other"]=(types[m.type||"Other"]||0)+1;
  const top=Object.entries(types).sort((a,b)=>b[1]-a[1]).slice(0,10), max=top[0]?.[1]||1;
  P.innerHTML=`<div class="mi-head"><div style="min-width:0"><h2>Missions</h2><div class="sub">Every employer handing out contracts, the faction behind them and what they pay. Pick one on the left.</div></div></div>
    ${statBlock([{label:"Employers",value:String(E.length)},{label:"Contracts",value:miN(law+un)}],[{label:"Lawful",value:miN(law)},{label:"Unlawful",value:miN(un)}])}
    <div class="vd-grid vd-flat bp-grid" style="margin-top:14px">
      <div class="vd-sec"><div class="mk-h">Kinds of work</div>${top.map(([t,n])=>`<div class="mi-bar"><span>${esc(t)}</span><i><b style="width:${Math.round(n/max*100)}%"></b></i><small>${n}</small></div>`).join("")}</div>
      <div class="vd-sec"><div class="mk-h">Most contracts</div>${E.slice(0,8).map(e=>`<div class="mk-row"><div class="w"><a data-mi="${esc(miKey(e))}">${esc(e.name)}</a></div><div class="p">${e.count}</div><span></span>
        <div class="m">${esc(e.faction&&e.faction.toLowerCase()!==e.name.toLowerCase()?e.faction:e.types.slice(0,3).join(", "))}</div></div>`).join("")}</div></div>
    <div class="uex-credit">${d.source==="game"?"From the game files (Quantum's game data).":"From the Star Citizen Wiki's mission data."}</div>`; }

$("mi-q").oninput=e=>{ S.mi.q=e.target.value; miRenderList(); };
$("mi-law").onchange=e=>{ S.mi.law=e.target.value; miRenderList(); };
$("mi-type").onchange=e=>{ S.mi.type=e.target.value; miRenderList(); };
$("mi-panel").addEventListener("click",async ev=>{ const t=ev.target;
  const pick=t.closest("[data-mi]"); if(pick){ S.mi.sel=pick.dataset.mi; S.mi.open=null; $("mi-panel").scrollTop=0; miRenderList(); return miRender(); }
  const ext=t.closest("[data-ext]"); if(ext){ api().open_url?.(ext.dataset.ext); return; }
  const tg=t.closest("[data-mitoggle]"); if(tg){ S.mi.open=S.mi.open===tg.dataset.mitoggle?null:tg.dataset.mitoggle; return miRender(); }
  const fr=t.closest("[data-mifretry]"); if(fr){ delete S.mi.fac[fr.dataset.mifretry]; return miRender(); }
  const op=t.closest("[data-open]"); if(op){ const n=op.dataset.open; if(S.locMap?.[n]){ select({kind:"loc",name:n}); focusLoc(n,true); } return; }
  const ad=t.closest("[data-miadd]"); if(ad){ await addStops([ad.dataset.miadd]); return miRender(); }
  const pg=t.closest("[data-mipage]"); if(pg){ const id=pg.dataset.mipage, [ek]=id.split("|"), e=S.mi.data.employers.find(x=>miKey(x)===ek);
    const m=e?.missions.find(x=>`${ek}|${x.code||x.ref||x.title}`===id); if(!m) return;
    S.mi.page[id]=null; miRender();
    let r; try{ r=await api().mission_page(m.ref||null,m.code||null,m.raw_title||m.title); }catch(_){ r={ok:false,error:"Couldn't look it up"}; }
    S.mi.page[id]=r.ok?(r.found?r.info:{missing:true}):{error:r.error}; if(S.tab==="missions") miRender(); } });
