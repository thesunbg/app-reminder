import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  jdFromDate, jdToDate, lunarMonthLength, lunarToSolar, solarToLunar, toSolarString,
} from '../src/lib/lunar.js'

describe('ngày Julian', () => {
  it('đi và về khớp nhau trên dải rộng', () => {
    for (let jd = 2200000; jd < 2600000; jd += 97) {
      const [d, m, y] = jdToDate(jd)
      assert.equal(jdFromDate(d, m, y), jd, `lệch ở jd=${jd} (${d}/${m}/${y})`)
    }
  })

  it('mốc đã biết', () => {
    assert.equal(jdFromDate(1, 1, 2000), 2451545)
  })
})

describe('âm lịch — mốc đã biết', () => {
  // Tết Nguyên Đán, mùng 1 tháng Giêng
  const TET: Array<[number, string]> = [
    [2020, '2020-01-25'],
    [2021, '2021-02-12'],
    [2022, '2022-02-01'],
    [2023, '2023-01-22'],
    [2024, '2024-02-10'],
    [2025, '2025-01-29'],
    [2026, '2026-02-17'],
    [2027, '2027-02-06'],
    [2028, '2028-01-26'],
  ]

  for (const [year, expected] of TET) {
    it(`Tết ${year} rơi vào ${expected}`, () => {
      const s = lunarToSolar(1, 1, year, false)
      assert.ok(s)
      assert.equal(toSolarString(s), expected)
    })
  }

  it('Giỗ Tổ Hùng Vương 10/3 âm', () => {
    assert.equal(toSolarString(lunarToSolar(10, 3, 2024, false)!), '2024-04-18')
    assert.equal(toSolarString(lunarToSolar(10, 3, 2025, false)!), '2025-04-07')
    assert.equal(toSolarString(lunarToSolar(10, 3, 2026, false)!), '2026-04-26')
  })

  it('Trung thu 15/8 âm', () => {
    assert.equal(toSolarString(lunarToSolar(15, 8, 2024, false)!), '2024-09-17')
    assert.equal(toSolarString(lunarToSolar(15, 8, 2025, false)!), '2025-10-06')
    assert.equal(toSolarString(lunarToSolar(15, 8, 2026, false)!), '2026-09-25')
  })
})

describe('âm lịch — tháng nhuận', () => {
  const LEAP: Array<[number, number | null]> = [
    [2020, 4], [2021, null], [2022, null], [2023, 2], [2024, null],
    [2025, 6], [2026, null], [2027, null], [2028, 5], [2029, null],
  ]

  for (const [year, leapMonth] of LEAP) {
    it(`năm ${year}: ${leapMonth ? `nhuận tháng ${leapMonth}` : 'không nhuận'}`, () => {
      const found: number[] = []
      for (let m = 1; m <= 12; m++) {
        if (lunarToSolar(1, m, year, true)) found.push(m)
      }
      assert.deepEqual(found, leapMonth ? [leapMonth] : [])
    })
  }

  it('đòi tháng nhuận ở năm không nhuận thì trả null, không trả bừa', () => {
    assert.equal(lunarToSolar(15, 6, 2026, true), null)
    assert.equal(lunarToSolar(1, 3, 2024, true), null)
  })

  it('tháng nhuận và tháng thường cùng số là hai tháng khác nhau', () => {
    const thuong = lunarToSolar(15, 6, 2025, false)!
    const nhuan = lunarToSolar(15, 6, 2025, true)!
    assert.notEqual(toSolarString(thuong), toSolarString(nhuan))
    // tháng nhuận đi ngay sau tháng thường -> cách nhau khoảng một tuần trăng
    const cach = jdFromDate(nhuan.day, nhuan.month, nhuan.year) - jdFromDate(thuong.day, thuong.month, thuong.year)
    assert.ok(cach === 29 || cach === 30, `cách nhau ${cach} ngày`)
  })
})

describe('âm lịch — đi và về', () => {
  it('dương → âm → dương khớp nhau suốt 1900–2100', () => {
    const from = jdFromDate(1, 1, 1900)
    const to = jdFromDate(31, 12, 2100)
    let checked = 0
    for (let jd = from; jd <= to; jd += 11) {
      const [d, m, y] = jdToDate(jd)
      const lunar = solarToLunar(d, m, y)
      const back = lunarToSolar(lunar.day, lunar.month, lunar.year, lunar.leap)
      assert.ok(back, `không quay về được từ ${d}/${m}/${y}`)
      assert.equal(
        toSolarString(back),
        toSolarString({ day: d, month: m, year: y }),
        `lệch ở ${d}/${m}/${y} → âm ${lunar.day}/${lunar.month}${lunar.leap ? 'N' : ''}/${lunar.year}`,
      )
      checked++
    }
    assert.ok(checked > 6000, `mới kiểm ${checked} ngày`)
  })

  it('ngày âm luôn trong khoảng 1..30 và tháng 1..12', () => {
    for (let jd = jdFromDate(1, 1, 1990); jd <= jdFromDate(31, 12, 2060); jd += 7) {
      const [d, m, y] = jdToDate(jd)
      const l = solarToLunar(d, m, y)
      assert.ok(l.day >= 1 && l.day <= 30, `ngày âm ${l.day} ở ${d}/${m}/${y}`)
      assert.ok(l.month >= 1 && l.month <= 12, `tháng âm ${l.month} ở ${d}/${m}/${y}`)
    }
  })
})

describe('độ dài tháng âm', () => {
  it('luôn là 29 hoặc 30 ngày', () => {
    for (let y = 2000; y <= 2050; y++) {
      for (let m = 1; m <= 12; m++) {
        const len = lunarMonthLength(m, y, false)
        assert.ok(len === 29 || len === 30, `tháng ${m}/${y} dài ${len} ngày`)
      }
    }
  })

  it('tháng 30 ngày thì ngày 30 tồn tại, tháng 29 ngày thì không', () => {
    for (let y = 2024; y <= 2030; y++) {
      for (let m = 1; m <= 12; m++) {
        const len = lunarMonthLength(m, y, false)
        const s = lunarToSolar(30, m, y, false)!
        const back = solarToLunar(s.day, s.month, s.year)
        if (len === 30) {
          assert.equal(back.day, 30, `ngày 30/${m}/${y} phải tồn tại`)
          assert.equal(back.month, m)
        } else {
          // tháng thiếu: "ngày 30" tràn sang mùng 1 tháng sau
          assert.equal(back.day, 1, `tháng ${m}/${y} chỉ có 29 ngày nên 30 phải tràn`)
        }
      }
    }
  })
})
