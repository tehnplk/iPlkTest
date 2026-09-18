// db-cli พิมพ์ผลทีละคำสั่งเมื่อรันหลายคำสั่ง (คั่นด้วยบรรทัด "command|N")
// UI สนใจแค่ชุดสุดท้าย ซึ่งคือ SELECT ที่โมเดลตั้งใจแสดง
export function lastResult(output) {
  const blocks = output.trim().split(/^command\|\d+\s*$/m)
  return blocks[blocks.length - 1]
    .trim()
    .split('\n')
    .map((line) => line.split('|'))
}
