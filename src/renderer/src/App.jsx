import { Component, useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import Chart from 'chart.js/auto'
import { Archive, ArchiveRestore, Check, Trash2 } from 'lucide-react'

const NEW_TITLE = 'การสนทนาใหม่'

// ชุดสีมาตรฐานสำหรับพื้นมืด เรียงตามลำดับตายตัว ห้ามวนใช้ซ้ำ (ผ่าน validator บนพื้น --agent แล้ว)
const SERIES = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767'
]
const INK = '#e8e8ea'
const MUTED = '#8b8b92'
const GRID = 'rgba(255,255,255,0.08)'
const SURFACE = '#1e2a23'

function ChartBox({ spec }) {
  const ref = useRef(null)
  useEffect(() => {
    const pie = spec.type === 'pie' || spec.type === 'doughnut'
    const radar = spec.type === 'radar'
    // ปิรามิดคือแท่งแนวนอนซ้อนกันสองฝั่ง chart.js ไม่มี type นี้ให้ตรงๆ
    const pyramid = spec.type === 'pyramid'
    // แท่งซ้อนก็คือ bar ที่เปิด stacked ทั้งสองแกน ต่างกันแค่ทิศ — โมเดลเลือกทิศมาเองแล้ว ไม่ต้องเดาให้
    const stack = pyramid || spec.type === 'stacked_column' || spec.type === 'stacked_bar'
    const bar = spec.type === 'bar' || stack
    // ป้ายไทยยาวๆ หรือหมวดเยอะๆ ในแนวตั้งจะถูกหมุนเฉียงแล้วตัดทิ้ง นอนแล้วอ่านได้เต็มทุกป้าย
    const sideways =
      pyramid ||
      spec.type === 'stacked_bar' ||
      (spec.type === 'bar' && (spec.labels.length > 10 || spec.labels.some((l) => l.length > 12)))
    const chart = new Chart(ref.current, {
      type: bar ? 'bar' : spec.type,
      data: {
        labels: spec.labels,
        datasets: spec.datasets.map((d, i) => ({
          ...d,
          // ชุดเดียว = สีเดียวทั้งกราฟ (สีบอก "ชุดไหน" ไม่ใช่ "แท่งไหน") ยกเว้นวงกลมที่แต่ละชิ้นคือคนละก้อน
          // radar ต้องโปร่ง ไม่งั้นชุดที่วาดทีหลังบังชุดแรกหมด
          backgroundColor: pie
            ? spec.labels.map((_, j) => SERIES[j % SERIES.length])
            : radar
              ? SERIES[i] + '38'
              : SERIES[i],
          borderColor: pie ? SURFACE : SERIES[i],
          // เว้นขอบสีพื้นระหว่างชิ้น กันชิ้นติดกันกลืนเป็นก้อนเดียว
          borderWidth: 2,
          borderRadius: bar ? 4 : undefined,
          pointRadius: spec.type === 'line' || radar ? 4 : undefined,
          pointBackgroundColor: SERIES[i],
          fill: radar,
          tension: 0.25
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        indexAxis: sideways ? 'y' : 'x',
        plugins: {
          title: { display: !!spec.title, text: spec.title, color: INK, font: { size: 14 } },
          // ชุดเดียวไม่ต้องมี legend หัวกราฟบอกอยู่แล้ว วงกลมต้องมีเพราะสีคือตัวบอกว่าชิ้นไหนคืออะไร
          legend: {
            display: pie || spec.datasets.length > 1,
            labels: { color: MUTED, boxWidth: 12 }
          },
          tooltip: {
            enabled: true,
            // ฝั่งซ้ายเก็บเป็นค่าติดลบ ผู้ใช้ต้องเห็นจำนวนจริง
            callbacks: pyramid
              ? { label: (c) => `${c.dataset.label}: ${Math.abs(c.parsed.x).toLocaleString()}` }
              : {}
          }
        },
        scales: pie
          ? {}
          : radar
            ? {
                r: {
                  grid: { color: GRID },
                  angleLines: { color: GRID },
                  pointLabels: { color: MUTED },
                  // ตัวเลขบนแกนกลางมีแผ่นรองสีขาวเป็นค่าเริ่มต้น บนพื้นมืดกลายเป็นป้ายสว่างกลางกราฟ
                  ticks: { color: MUTED, backdropColor: 'transparent' }
                }
              }
            : sideways
              ? {
                  // แนวนอน: แกนค่าคือ x แกนหมวดคือ y (ปิรามิดซ้อนสองฝั่งเพิ่ม)
                  x: {
                    stacked: stack,
                    beginAtZero: true,
                    grid: { color: GRID },
                    ticks: { color: MUTED, callback: (v) => Math.abs(v).toLocaleString() }
                  },
                  // กลุ่มอายุน้อยต้องอยู่ล่างสุดตามแบบปิรามิด (query ส่งมาน้อยไปมาก)
                  y: {
                    stacked: stack,
                    reverse: pyramid,
                    grid: { color: GRID },
                    ticks: { color: MUTED }
                  }
                }
              : {
                  x: { stacked: stack, ticks: { color: MUTED }, grid: { color: GRID } },
                  y: {
                    stacked: stack,
                    ticks: { color: MUTED },
                    grid: { color: GRID },
                    beginAtZero: true
                  }
                }
      }
    })
    return () => chart.destroy()
  }, [spec])

  // แท่งแนวนอนเยอะๆ ในกล่องสูงคงที่จะถูกบีบจนบางเป็นเส้น
  const tall =
    (spec.type === 'pyramid' || spec.type === 'stacked_bar' || spec.type === 'bar') &&
    spec.labels.length > 10
  return (
    <div
      className="chart"
      // ไว้ให้เทสต์อ่านว่าวาดกราฟชนิดไหนจริง ๆ โดยไม่ต้องเดาจากภาพ
      data-chart-type={spec.type}
      data-points={spec.labels.length}
      style={tall ? { height: 26 * spec.labels.length + 120 } : undefined}
    >
      <canvas ref={ref} />
    </div>
  )
}

// step.result มาจาก main เป็น {columns, rows, rowCount, truncated} หรือ {error}
function Result({ step }) {
  const r = step.result ?? {}
  if (r.error) return <div className="result-error">{r.error}</div>

  const file = r.file && (
    <button className="open-file" onClick={() => window.api.openFile(r.file)}>
      📄 เปิดไฟล์ Excel ({r.rowCount.toLocaleString()} แถว)
    </button>
  )
  if (r.chart) return <ChartBox spec={r.chart} />

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
  const [tab, setTab] = useState('recent')
  // id ของห้องที่กดถังขยะไปแล้วหนึ่งครั้ง กำลังรอกดยืนยัน
  const [confirmId, setConfirmId] = useState(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [runningSql, setRunningSql] = useState('')
  const [streamed, setStreamed] = useState('')
  const [models, setModels] = useState([])
  // จำโมเดลที่เลือกไว้ในเครื่อง ไม่ต้องเลือกใหม่ทุกครั้งที่เปิดแอป
  const [model, setModel] = useState(() => localStorage.getItem('model') || '')
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

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [active?.messages.length, activeId, runningSql, streamed])

  // กดถังขยะครั้งแรก = ถาม (ไอคอนเปลี่ยนเป็นเครื่องหมายถูกสีแดง) กดซ้ำถึงลบจริง
  // เอาเมาส์ออกจากแถวแล้วยกเลิกเอง ไม่ต้องมีปุ่มยกเลิก
  const removeConvo = async (id) => {
    if (confirmId !== id) return setConfirmId(id)
    setConfirmId(null)
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

  // เก็บเข้าคลัง = ไม่โดนลบตอนครบ 30 วัน ห้องจะย้ายไปอีกแท็บทันที
  const toggleArchive = async (id, archived) => {
    await window.api.convos.archive(id, !archived)
    setConvos((prev) => prev.map((c) => (c.id === id ? { ...c, archived: !archived } : c)))
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
        <div className="convo-tabs">
          {[
            ['recent', 'ประวัติแชท'],
            ['archive', 'คลัง']
          ].map(([key, label]) => (
            <button
              key={key}
              className={'convo-tab' + (tab === key ? ' active' : '')}
              onClick={() => setTab(key)}
            >
              {label} ({convos.filter((c) => !!c.archived === (key === 'archive')).length})
            </button>
          ))}
        </div>
        <div className="convo-list">
          {tab === 'recent' && <div className="convo-note">เก็บ 30 วัน เกินกำหนดลบอัตโนมัติ</div>}
          {convos
            .filter((c) => !!c.archived === (tab === 'archive'))
            .map((c) => (
              <div
                key={c.id}
                className={'convo-row' + (c.id === activeId ? ' active' : '')}
                onMouseLeave={() => confirmId === c.id && setConfirmId(null)}
              >
                <button className="convo" onClick={() => setActiveId(c.id)}>
                  {c.title}
                </button>
                <button
                  className={'convo-archive' + (c.archived ? ' on' : '')}
                  title={
                    c.archived ? 'เอาออกจากคลัง (กลับไปนับอายุ 30 วัน)' : 'เก็บเข้าคลัง ไม่ลบทิ้ง'
                  }
                  onClick={() => toggleArchive(c.id, c.archived)}
                >
                  {c.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                </button>
                <button
                  className={'convo-del' + (confirmId === c.id ? ' confirm' : '')}
                  title={confirmId === c.id ? 'กดอีกครั้งเพื่อลบถาวร' : 'ลบบทสนทนานี้'}
                  onClick={() => removeConvo(c.id)}
                >
                  {confirmId === c.id ? <Check size={14} /> : <Trash2 size={14} />}
                </button>
              </div>
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
                  <Safe>
                    <Result step={m.step} />
                  </Safe>
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
