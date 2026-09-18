import { useEffect, useRef, useState } from 'react'
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
  // ผลจาก rest_api ไม่ใช่ตาราง
  if (r.status !== undefined)
    return (
      <pre className="result-raw">
        {`HTTP ${r.status}
`}
        {(typeof r.body === 'string' ? r.body : JSON.stringify(r.body, null, 2)).slice(0, 4000)}
      </pre>
    )
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
  const endRef = useRef(null)

  const active = convos.find((c) => c.id === activeId)

  useEffect(() => {
    window.api.convos.list().then(async (rows) => {
      if (rows.length === 0) {
        const id = await window.api.convos.create(NEW_TITLE)
        rows = [{ id, title: NEW_TITLE, messages: [] }]
      }
      setConvos(rows)
      setActiveId(rows[0].id)
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

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [active?.messages.length, activeId, runningSql, streamed])

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
      reply = await window.api.agent.send(sent, model)
    } catch (err) {
      reply = { role: 'assistant', content: `เรียก agent ไม่สำเร็จ: ${err.message}` }
    }

    const messages = [...sent, reply]
    setConvos((prev) => prev.map((c) => (c.id === activeId ? { ...c, title, messages } : c)))
    setBusy(false)
    setRunningSql('')
    setStreamed('')
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
            <button
              key={c.id}
              className={'convo' + (c.id === activeId ? ' active' : '')}
              onClick={() => setActiveId(c.id)}
            >
              {c.title}
            </button>
          ))}
        </div>
      </aside>

      <main className="chat">
        <header className="chat-header">
          <span className="title">{active?.title ?? ''}</span>
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
                  <Result step={m.step} />
                </>
              )}
              {/* คำตอบ agent เป็น markdown (react-markdown escape ให้ ไม่ต้องยุ่งกับ innerHTML) */}
              {m.role === 'assistant' ? <Markdown>{m.content}</Markdown> : m.content}
              {/^[⏹⚠]/.test(m.content ?? '') && !busy && (
                <button className="continue" onClick={() => submit('continue')}>
                  ▶ ทำต่อ
                </button>
              )}
            </div>
          ))}
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
