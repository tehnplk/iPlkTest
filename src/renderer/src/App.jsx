import { Component, useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import { lastResult } from './parse.mjs'

const NEW_TITLE = 'การสนทนาใหม่'

// step.result มาจาก main เป็น {columns, rows, rowCount, truncated} หรือ {error}
// step.output คือของเก่าสมัยยิงผ่าน db-cli (ข้อความคั่นด้วย |) ยังต้องอ่านได้อยู่
function Result({ step }) {
  const r = step.result ?? legacy(step.output)
  if (r.error) return <div className="result-error">{r.error}</div>

  const file = r.file && (
    <button className="open-file" onClick={() => window.api.openFile(r.file)}>
      📄 เปิดไฟล์ Excel ({r.rowCount.toLocaleString()} แถว)
    </button>
  )
  // ผลจาก tool ความจำ
  if (r.saved) return <div className="more">🧠 จำไว้แล้ว: {r.saved}</div>
  if (r.forgot) return <div className="more">🧠 ลืมแล้ว: {r.forgot.join(', ')}</div>

  // ผลจาก rest_api ไม่ใช่ตาราง
  if (r.status !== undefined)
    return (
      <pre className="result-raw">
        {`HTTP ${r.status}
`}
        {(typeof r.body === 'string' ? r.body : JSON.stringify(r.body, null, 2)).slice(0, 4000)}
      </pre>
    )
  // tool อื่นที่ไม่ได้คืนตาราง — อย่าให้หน้าจอพังเพราะรูปแบบไม่ตรง
  if (!r.columns) return <pre className="result-raw">{JSON.stringify(r, null, 1)}</pre>
  if (!r.columns.length) return <div className="more">รันสำเร็จ ({r.rowCount} แถวถูกแก้ไข)</div>

  return (
    <div className="result">
      <table>
        <thead>
          <tr>
            {r.columns.map((c, i) => (
              <th key={i}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {r.rows.map((row, i) => (
            <tr key={i}>
              {row.map((v, j) => (
                <td key={j}>{v ?? 'NULL'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {r.truncated && (
        <div className="more">
          …แสดง {r.rows.length} จาก {r.rowCount.toLocaleString()} แถว
        </div>
      )}
      {file}
    </div>
  )
}

function legacy(output = '') {
  const [head, ...body] = lastResult(output)
  if (head.length < 2) return { error: output }
  return {
    columns: head,
    rows: body.slice(0, 200),
    rowCount: body.length,
    truncated: body.length > 200
  }
}

// ผลจาก tool รูปแบบใหม่ๆ ไม่ควรทำให้ทั้งหน้าจอหาย — พังเฉพาะข้อความนั้นพอ
class Safe extends Component {
  state = { err: null }
  static getDerivedStateFromError(err) {
    return { err }
  }
  render() {
    if (!this.state.err) return this.props.children
    return <div className="result-error">แสดงผลลัพธ์ไม่ได้: {String(this.state.err.message)}</div>
  }
}

function CopyButton({ text }) {
  const [done, setDone] = useState(false)
  return (
    <button
      className="copy"
      title="คัดลอก SQL"
      onClick={(e) => {
        // กันไม่ให้ <details> พับ/กางตอนกดปุ่มที่อยู่ใน <summary>
        e.preventDefault()
        e.stopPropagation()
        navigator.clipboard.writeText(text).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1200)
        })
      }}
    >
      {done ? '✓ คัดลอกแล้ว' : 'คัดลอก'}
    </button>
  )
}

function App() {
  const [convos, setConvos] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [runningSql, setRunningSql] = useState('')
  const [streamed, setStreamed] = useState('')
  const [models, setModels] = useState([])
  // จำโมเดลที่เลือกไว้ในเครื่อง ไม่ต้องเลือกใหม่ทุกครั้งที่เปิดแอป
  const [model, setModel] = useState(() => localStorage.getItem('model') || '')
  const [engine, setEngine] = useState(() => localStorage.getItem('engine') || 'loop')
  const [approval, setApproval] = useState(null)
  const endRef = useRef(null)
  const started = useRef(false)

  const active = convos.find((c) => c.id === activeId)

  // เปิดแอปทีไรเริ่มที่ห้องใหม่เสมอ ของเก่ายังอยู่ในรายการให้กดกลับไปดูได้
  useEffect(() => {
    if (started.current) return // StrictMode ในโหมด dev เรียก effect ซ้ำ กันไม่ให้สร้างสองห้อง
    started.current = true
    window.api.convos.list().then(async (rows) => {
      const id = await window.api.convos.create(NEW_TITLE)
      setConvos([{ id, title: NEW_TITLE, messages: [] }, ...rows])
      setActiveId(id)
    })
  }, [])

  useEffect(() => {
    window.api.agent.models().then((list) => {
      setModels(list)
      setModel((cur) => (list.includes(cur) ? cur : list[0]))
    })
  }, [])

  // main ส่ง sql ที่กำลังรัน และตัวอักษรที่โมเดลพิมพ์ มาแบบ realtime
  useEffect(
    () =>
      window.api.agent.onStep(({ sql }) => {
        setRunningSql(sql)
        setStreamed('') // ขึ้น query ใหม่ = เริ่มตอบรอบใหม่
      }),
    []
  )

  useEffect(() => window.api.agent.onDelta((t) => setStreamed((prev) => prev + t)), [])

  // ฝั่ง SDK จะหยุดถามก่อนรันคำสั่งเสี่ยง
  useEffect(() => window.api.agent.onApproval(setApproval), [])

  const answerApproval = (ok) => {
    window.api.agent.approve(approval.id, ok)
    setApproval(null)
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [active?.messages.length, activeId, runningSql, streamed])

  const removeConvo = async (id, title) => {
    if (!window.confirm(`ลบบทสนทนา "${title}" ?`)) return
    await window.api.convos.remove(id)
    const left = convos.filter((c) => c.id !== id)
    setConvos(left)
    if (id !== activeId) return
    // ลบห้องที่เปิดอยู่ → ย้ายไปห้องแรกที่เหลือ ถ้าไม่เหลือเลยก็เปิดห้องใหม่
    if (left.length) setActiveId(left[0].id)
    else newConvo()
  }

  const newConvo = async () => {
    const id = await window.api.convos.create(NEW_TITLE)
    setConvos((prev) => [{ id, title: NEW_TITLE, messages: [] }, ...prev])
    setActiveId(id)
  }

  const send = (e) => {
    e.preventDefault()
    submit(draft.trim())
  }

  // Enter = ส่ง, Alt+Enter = ขึ้นบรรทัดใหม่ (เบราว์เซอร์ไม่ใส่ \n ให้เองเมื่อกด Alt)
  const onKeyDown = (e) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    e.preventDefault()
    if (!e.altKey) return submit(draft.trim())

    const el = e.target
    const at = el.selectionStart
    setDraft(draft.slice(0, at) + '\n' + draft.slice(el.selectionEnd))
    requestAnimationFrame(() => el.setSelectionRange(at + 1, at + 1))
  }

  const submit = async (text) => {
    if (!text || !active || busy) return
    setDraft('')
    setBusy(true)
    setRunningSql('')
    setStreamed('')

    const sent = [...active.messages, { role: 'user', content: text }]
    const title = active.messages.length ? active.title : text.slice(0, 40)
    setConvos((prev) => prev.map((c) => (c.id === activeId ? { ...c, title, messages: sent } : c)))

    let reply
    try {
      // reasoning_details ของข้อความเก่าถูกส่งกลับไปด้วย โมเดลจะคิดต่อจากเดิม
      reply = await window.api.agent.send(sent, model, engine)
    } catch (err) {
      reply = { role: 'assistant', content: `เรียก agent ไม่สำเร็จ: ${err.message}` }
    }

    const messages = [...sent, reply]
    setConvos((prev) => prev.map((c) => (c.id === activeId ? { ...c, title, messages } : c)))
    setBusy(false)
    setRunningSql('')
    setStreamed('')
    setApproval(null)
    await window.api.convos.save({ id: activeId, title, messages })
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <button className="new-chat" onClick={newConvo}>
          + {NEW_TITLE}
        </button>
        <div className="convo-list">
          {convos.map((c) => (
            <div key={c.id} className={'convo-row' + (c.id === activeId ? ' active' : '')}>
              <button className="convo" onClick={() => setActiveId(c.id)}>
                {c.title}
              </button>
              <button
                className="convo-del"
                title="ลบบทสนทนานี้"
                onClick={() => removeConvo(c.id, c.title)}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </aside>

      <main className="chat">
        <header className="chat-header">
          <span className="title">{active?.title ?? ''}</span>
          <select
            value={engine}
            title="กลไกที่ใช้คุมรอบคุยกับโมเดล — loop: เขียนเอง มีรอบตรวจคำตอบ / sdk: @openai/agents มีขออนุมัติก่อนรัน"
            onChange={(e) => {
              setEngine(e.target.value)
              localStorage.setItem('engine', e.target.value)
            }}
          >
            <option value="loop">loop (เขียนเอง)</option>
            <option value="sdk">sdk (@openai/agents)</option>
          </select>
          <select
            value={model}
            onChange={(e) => {
              setModel(e.target.value)
              localStorage.setItem('model', e.target.value)
            }}
          >
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </header>
        <div className="messages">
          {active?.messages.length === 0 && <div className="empty">ถาม SQL ของ HOSxP ได้เลย</div>}
          {active?.messages.map((m, i) => (
            <div key={i} className={'msg ' + m.role}>
              {m.step && (
                <>
                  {/* ย่อไว้เป็นค่าเริ่มต้น กดกางดูคำสั่งเต็มได้ (ใช้ <details> ของเบราว์เซอร์ ไม่ต้องมี state) */}
                  <details className="sql-box">
                    <summary>{m.step.sql.replace(/\s+/g, ' ').slice(0, 80)}</summary>
                    <div className="sql-wrap">
                      <pre className="sql">{m.step.sql}</pre>
                      <CopyButton text={m.step.sql} />
                    </div>
                  </details>
                  <Safe>
                    <Result step={m.step} />
                  </Safe>
                </>
              )}
              {/* คำตอบ agent เป็น markdown (react-markdown escape ให้ ไม่ต้องยุ่งกับ innerHTML) */}
              {m.role === 'assistant' ? <Markdown>{m.content}</Markdown> : m.content}
              {m.verified && <div className="verified">✓ ตรวจตัวเลขกับผลลัพธ์แล้ว</div>}
              {/^[⏹⚠]/.test(m.content ?? '') && !busy && (
                <button className="continue" onClick={() => submit('continue')}>
                  ▶ ทำต่อ
                </button>
              )}
            </div>
          ))}
          {approval && (
            <div className="msg assistant approval">
              <div>ขออนุมัติรัน {approval.name}</div>
              <pre className="sql">{approval.args}</pre>
              <div className="approval-buttons">
                <button onClick={() => answerApproval(true)}>อนุมัติ</button>
                <button className="reject" onClick={() => answerApproval(false)}>
                  ไม่อนุมัติ
                </button>
              </div>
            </div>
          )}
          {busy && (
            <div className="msg assistant">
              {streamed ? (
                <Markdown>{streamed}</Markdown>
              ) : (
                <>
                  <span className="dots">กำลังคิด...</span>
                  {runningSql && <pre className="sql running">{runningSql}</pre>}
                </>
              )}
            </div>
          )}
          <div ref={endRef} />
        </div>
        <form className="composer" onSubmit={send}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="พิมพ์ข้อความ... (Alt+Enter ขึ้นบรรทัดใหม่)"
            autoFocus
          />
          {busy ? (
            <button type="button" className="stop" onClick={() => window.api.agent.stop()}>
              หยุด
            </button>
          ) : (
            <button type="submit">ส่ง</button>
          )}
        </form>
      </main>
    </div>
  )
}

export default App
