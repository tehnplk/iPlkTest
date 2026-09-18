// เทิร์นก่อนหน้าที่เคย query ต้องประกอบกลับเป็น tool_calls + tool ตามรูปแบบจริงของ API
// เคยยัด [sql: ...] กับ JSON ลงใน content ของ assistant แล้วโมเดลลอกรูปแบบนั้นไปพิมพ์เป็นคำตอบ
export function toHistory(messages) {
  return messages.flatMap(({ role, content, reasoning_details, step }, i) => {
    const self = { role, content, ...(reasoning_details ? { reasoning_details } : {}) }
    if (role !== 'assistant' || !step) return [self]

    const id = `hist_${i}`
    return [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id,
            type: 'function',
            function: { name: 'sql', arguments: JSON.stringify({ sql: step.sql }) }
          }
        ]
      },
      {
        role: 'tool',
        tool_call_id: id,
        content: JSON.stringify(step.result ?? step.output).slice(0, 2000)
      },
      self
    ]
  })
}
