// ponytail: weekends-only business-day math, no holiday calendar - that's
// the documented ceiling here. A holiday calendar is a separate ask if wanted.
function addBusinessDays(startDate, days) {
  const d = new Date(startDate)
  let added = 0
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1)
    const dow = d.getUTCDay() // 0=Sun, 6=Sat
    if (dow !== 0 && dow !== 6) added++
  }
  return d
}

module.exports = { addBusinessDays }
