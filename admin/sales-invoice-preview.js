(() => {
  // Round the preview per invoice line, matching PostgreSQL numeric round(...,2).
  const decimal = value => {
    const raw = String(value ?? 0).trim();
    const match=raw.match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
    if (!match) return null;
    const fraction=match[2]||'',places=fraction.length-Number(match[3]||0);
    if (!Number.isSafeInteger(places) || Math.abs(places)>1000) return null;
    const coefficient=BigInt(match[1]+fraction);
    return places<0 ? {value:coefficient*10n**BigInt(-places),scale:1n} : {value:coefficient,scale:10n**BigInt(places)};
  };
  function lineAmount(item,quantity) {
    const qty=decimal(quantity),price=decimal(item.unit_price);
    if (!qty || !price) return 0;
    const ordered=decimal(item.ordered_quantity);
    if (ordered && qty.value*ordered.scale===ordered.value*qty.scale && item.entered_line_total != null) {
      const total=decimal(item.entered_line_total);
      if (total) return Number((total.value*100n*2n+total.scale)/(total.scale*2n))/100;
    }
    const numerator=qty.value*price.value*100n,denominator=qty.scale*price.scale;
    return Number((numerator*2n+denominator)/(denominator*2n))/100;
  }
  function totals(lines) {
    const units=new Map();let cents=0;
    for (const {item,quantity} of lines) {
      const qty=Number(quantity||0);
      if (!Number.isFinite(qty) || qty<=0) continue;
      const unit=item.unit||'unidades';
      units.set(unit,(units.get(unit)||0)+qty);
      cents+=Math.round(lineAmount(item,quantity)*100);
    }
    return {amount:cents/100,units:[...units].map(([unit,quantity])=>({unit,quantity}))};
  }
  window.SalesInvoicePreview={lineAmount,totals};
})();
