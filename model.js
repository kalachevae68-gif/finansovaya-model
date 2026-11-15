/* Финансовая модель пекарни — расчёты один в один с листами «Финмодель» и «Сценарный анализ».
   Номера строк/ячеек в комментариях — ссылки на исходную таблицу. */
(function (root) {
  'use strict';

  // Постоянные параметры с листа «Параметры» (столбец F)
  var FIXED = {
    payroll: 120000 + 90000 + 80000, // SUMIF(B="*ФОТ*") — F19+F20+F21
    rent: 102000,                    // F22
    utilities: 12000,                // F23
    aggregatorFee: 0.2,              // F7
    capex: 95000 + 60000 + 600000 + 105500 + 81000 + 120000, // SUMIF(B="Стоимость оборудования") — F32:F37
    usefulLife: 84,                  // F38, мес
    dpoDays: 20,                     // F41
    taxRate: 0.06,                   // F43
    discountRate: 0.3,               // F44
    otherAdmin: 10000                // F29
  };

  // Изменяемые параметры (голубые ячейки «Финмодели») — значения по умолчанию из таблицы
  var DEFAULTS = {
    startDate: '2025-09-04', // B4
    horizon: 24,             // B5
    traffic: 70,             // строка 10, F2 (в таблице 500 — даёт 9,75 млн ₽/мес; 70 — окупаемость в пределах 24 мес. во всех сценариях)
    conversion: 0.25,        // 11, F3
    avgCheck: 250,           // 12, F4
    hoursPerDay: 12,         // 13, F12
    daysPerMonth: 26,        // 14, F13
    cogsShare: 0.35,         // 15, F15
    marketing: 0.5,          // 16, F25
    retailShare: 0.8,        // 17, F5
    deliveryShare: 0.2       // 18, F6
  };

  var MAX_MONTHS = 24; // столбцы C…Z

  var MONTHS = ['янв.', 'февр.', 'март', 'апр.', 'май', 'июнь', 'июль', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];

  function monthLabels(startDate, n) {
    var d = new Date(startDate + 'T00:00:00');
    var y = d.getFullYear(), m = d.getMonth(), out = [];
    for (var t = 0; t < n; t++) { // EDATE($B$4, t), формат «ммм гг»
      var mm = (m + t) % 12, yy = y + Math.floor((m + t) / 12);
      out.push(MONTHS[mm] + ' ' + String(yy).slice(-2));
    }
    return out;
  }

  function div(a, b) { return b === 0 ? NaN : a / b; }

  // IRR как в Excel: нужен хотя бы один положительный и один отрицательный поток
  function irr(flows) {
    var hasPos = flows.some(function (v) { return v > 0; });
    var hasNeg = flows.some(function (v) { return v < 0; });
    if (!hasPos || !hasNeg) return null;
    function npv(r) { var s = 0; for (var i = 0; i < flows.length; i++) s += flows[i] / Math.pow(1 + r, i); return s; }
    var lo = -0.9999, hi = 1, flo = npv(lo), fhi = npv(hi);
    while (flo * fhi > 0 && hi < 1e6) { hi *= 2; fhi = npv(hi); }
    if (flo * fhi > 0) return null;
    for (var k = 0; k < 300; k++) {
      var mid = (lo + hi) / 2, fm = npv(mid);
      if (Math.abs(fm) < 1e-9) return mid;
      if (flo * fm < 0) { hi = mid; } else { lo = mid; flo = fm; }
    }
    return (lo + hi) / 2;
  }

  function calc(input, fixed) {
    var p = Object.assign({}, DEFAULTS, input || {});
    var f = fixed || FIXED;
    var T = Math.max(1, Math.min(MAX_MONTHS, Math.floor(p.horizon) || 1)); // IF(t+1<=$B$5,…)

    var r = { months: monthLabels(p.startDate, T), T: T, p: p, fixed: f };
    var keys = ['revenue', 'cogsRaw', 'cogsPack', 'cogsSanit', 'cogsLogist', 'cogsTotal', 'grossProfit', 'grossMargin',
      'commissions', 'opexPayroll', 'opexRent', 'opexUtilities', 'opexMarketing', 'opexOther', 'opexTotal', 'ebitda',
      'depreciation', 'ebit', 'finExpenses', 'tax', 'netProfit', 'netMargin',
      'cashBegin', 'cashInSales', 'cashCapex', 'cashSuppliers', 'cashPayroll', 'cashRentUtil', 'cashMarketing',
      'cashOther', 'cashTax', 'inflow', 'outflow', 'netCf', 'cashEnd', 'cumFlow'];
    keys.forEach(function (k) { r[k] = []; });

    for (var t = 0; t < T; t++) {
      // Блок 2 — ОПиУ
      var revenue = p.traffic * p.hoursPerDay * p.daysPerMonth * p.conversion * p.avgCheck; // 26
      var cogsRaw = revenue * p.cogsShare;   // 27
      var cogsPack = revenue * 0.03;         // 28
      var cogsSanit = revenue * 0.02;        // 29
      var cogsLogist = revenue * 0.05;       // 30
      var cogsTotal = cogsRaw + cogsPack + cogsSanit + cogsLogist; // 31
      var grossProfit = revenue - cogsTotal; // 32
      var commissions = revenue * p.deliveryShare * f.aggregatorFee; // 34
      var opexTotal = f.payroll + f.rent + f.utilities + p.marketing + f.otherAdmin; // 35–40
      var ebitda = grossProfit - commissions - opexTotal; // 41
      var depreciation = f.capex / f.usefulLife;          // 42
      var ebit = ebitda - depreciation;                   // 43
      var finExpenses = 0;                                // 44
      var tax = Math.max(0, revenue * f.taxRate);         // 45
      var netProfit = ebit - finExpenses - tax;           // 46

      r.revenue.push(revenue); r.cogsRaw.push(cogsRaw); r.cogsPack.push(cogsPack); r.cogsSanit.push(cogsSanit);
      r.cogsLogist.push(cogsLogist); r.cogsTotal.push(cogsTotal); r.grossProfit.push(grossProfit);
      r.grossMargin.push(div(grossProfit, revenue)); r.commissions.push(commissions);
      r.opexPayroll.push(f.payroll); r.opexRent.push(f.rent); r.opexUtilities.push(f.utilities);
      r.opexMarketing.push(p.marketing); r.opexOther.push(f.otherAdmin); r.opexTotal.push(opexTotal);
      r.ebitda.push(ebitda); r.depreciation.push(depreciation); r.ebit.push(ebit); r.finExpenses.push(finExpenses);
      r.tax.push(tax); r.netProfit.push(netProfit); r.netMargin.push(div(netProfit, revenue));

      // Блок 3 — ДДС
      var cashBegin = t === 0 ? 0 : r.cumFlow[t - 1];      // 52
      var cashInSales = revenue - commissions;             // 53
      var cashCapex = t === 0 ? f.capex : 0;               // 54
      var cashSuppliers = cogsRaw * (1 - f.dpoDays / 30);  // 55
      var cashPayroll = f.payroll * 1.34;                  // 56
      var cashRentUtil = f.rent + f.utilities;             // 57
      var cashMarketing = p.marketing;                     // 58
      var cashOther = f.otherAdmin;                        // 59
      var cashTax = tax;                                   // 60
      var inflow = cashInSales;                            // 61
      var outflow = cashCapex + cashSuppliers + cashPayroll + cashRentUtil + cashMarketing + cashOther + cashTax; // 62
      var netCf = inflow - outflow;                        // 63
      var cashEnd = cashBegin + netCf;                     // 64
      var cumFlow = t === 0 ? netCf : r.cumFlow[t - 1] + netCf; // 65

      r.cashBegin.push(cashBegin); r.cashInSales.push(cashInSales); r.cashCapex.push(cashCapex);
      r.cashSuppliers.push(cashSuppliers); r.cashPayroll.push(cashPayroll); r.cashRentUtil.push(cashRentUtil);
      r.cashMarketing.push(cashMarketing); r.cashOther.push(cashOther); r.cashTax.push(cashTax);
      r.inflow.push(inflow); r.outflow.push(outflow); r.netCf.push(netCf); r.cashEnd.push(cashEnd);
      r.cumFlow.push(cumFlow);
    }

    // Блок 4 — ключевые показатели
    var rm = Math.pow(1 + f.discountRate, 1 / 12) - 1;  // C70: POWER(1+C69,1/12)-1
    var npv = r.netCf[0];
    for (var i = 1; i < T; i++) npv += r.netCf[i] / Math.pow(1 + rm, i); // NPV(r, D63:Z63) + C63
    var minCum = Math.min.apply(null, r.cumFlow);
    var paybackIdx = r.cumFlow.findIndex(function (v) { return v > 0; });
    var irrM = irr(r.netCf);

    r.kpi = {
      mixOk: Math.abs(p.retailShare + p.deliveryShare - 1) < 0.01,  // B6
      monthlyRate: rm,
      npv: npv,                                                    // C70
      investmentNeed: Math.max(0, -minCum),                        // C71
      paybackMonth: paybackIdx === -1 ? null : paybackIdx + 1,     // C72
      irrAnnual: irrM === null ? null : Math.pow(1 + irrM, 12) - 1 // C73
    };
    return r;
  }

  // Лист «Сценарный анализ» — расчёт за один месяц, дельты к базе (доли: 0.1 = +10 %)
  function scenarios(input, deltas, fixed) {
    var p = Object.assign({}, DEFAULTS, input || {});
    var f = fixed || FIXED;
    var depreciation = f.capex / f.usefulLife; // B15
    var names = ['Оптимистичный', 'Базовый', 'Пессимистичный'];
    return names.map(function (name, idx) {
      var d = Object.assign({ traffic: 0, conversion: 0, avgCheck: 0, cogsShare: 0, payroll: 0 }, (deltas || [])[idx] || {});
      var traffic = p.traffic * (1 + d.traffic);           // 29
      var conversion = p.conversion * (1 + d.conversion);  // 30
      var check = p.avgCheck * (1 + d.avgCheck);           // 31
      var revenue = traffic * p.hoursPerDay * p.daysPerMonth * conversion * check; // 32
      var deliveryShare = p.deliveryShare;                 // 33
      var revDelivery = revenue * deliveryShare;           // 34
      var revRetail = revenue - revDelivery;               // 35
      var cogs = revenue * p.cogsShare * (1 + d.cogsShare); // 36
      var commission = revDelivery * f.aggregatorFee;      // 37
      var payroll = f.payroll * (1 + d.payroll);           // 38
      var ebit = revenue - cogs - commission - payroll - f.rent - f.utilities - depreciation; // 42
      var tax = Math.max(0, revenue * f.taxRate);          // 43
      var netProfit = ebit - tax;                          // 44
      var netCf = netProfit + depreciation - f.capex;      // 45
      // Окупаемость (добавлено к листу): месяц 1 — строка 45, далее каждый месяц + (чистая прибыль + амортизация);
      // как C72 «Финмодели» — первый месяц, где накопленный поток > 0
      var monthlyCf = netProfit + depreciation;
      var cum = [], acc = 0;
      for (var t = 0; t < MAX_MONTHS; t++) { acc += t === 0 ? netCf : monthlyCf; cum.push(acc); }
      var payback = netCf > 0 ? 1 : (monthlyCf > 0 ? Math.floor(f.capex / monthlyCf) + 1 : null);
      return {
        name: name, traffic: traffic, conversion: conversion, avgCheck: check, revenue: revenue,
        deliveryShare: deliveryShare, revDelivery: revDelivery, revRetail: revRetail, cogs: cogs,
        commission: commission, payroll: payroll, rent: f.rent, utilities: f.utilities,
        depreciation: depreciation, ebit: ebit, tax: tax, netProfit: netProfit, netCf: netCf,
        monthlyCf: monthlyCf, cumFlow: cum, paybackMonth: payback
      };
    });
  }

  // Дельты сценариев по умолчанию (в таблице заполнен только «Базовый» нулями)
  var DEFAULT_DELTAS = [
    { traffic: 0.10, conversion: 0.10, avgCheck: 0.10, cogsShare: -0.05, payroll: 0 },   // Оптимистичный
    { traffic: 0, conversion: 0, avgCheck: 0, cogsShare: 0, payroll: 0 },                // Базовый
    { traffic: -0.10, conversion: -0.10, avgCheck: -0.10, cogsShare: 0.05, payroll: 0.10 } // Пессимистичный
  ];

  var api = { FIXED: FIXED, DEFAULTS: DEFAULTS, DEFAULT_DELTAS: DEFAULT_DELTAS, MAX_MONTHS: MAX_MONTHS, calc: calc, scenarios: scenarios };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FinModel = api;
})(this);
