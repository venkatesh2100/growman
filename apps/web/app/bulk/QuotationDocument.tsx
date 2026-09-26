import { forwardRef } from "react";
import {
  chargeValue,
  formatLineAmount,
  formatQuantity,
  formatRate,
  formatRupees,
  QUOTATION_ISSUER,
  type Quotation,
} from "../../lib/quotation";

const cell = "border border-black px-1.5 py-1 text-[11px] sm:text-xs";
const head = `${cell} text-center font-bold`;

/** The quotation in the nursery's printed format: black rules, Arial, bold header row. */
const QuotationDocument = forwardRef<HTMLDivElement, { quotation: Quotation }>(
  function QuotationDocument({ quotation: q }, ref) {
    const r = q.requester;

    return (
      <div ref={ref} className="bg-white p-4 text-black sm:p-6" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
        <p className="mb-2 text-center text-xl font-bold sm:text-2xl">Quotation</p>

        <table className="w-full border-collapse border border-black">
          <tbody>
            <tr>
              <td className="w-[58%] border border-black px-2 py-1.5 align-middle">
                {/* eslint-disable-next-line @next/next/no-img-element -- printed via an iframe copy, needs a plain img */}
                <img
                  src="/quotation/nursery-logo.png"
                  alt={QUOTATION_ISSUER.name}
                  className="block h-auto w-full"
                />
                <p className="mt-1 border-t border-black pt-1 text-center text-[9px] leading-tight sm:whitespace-nowrap sm:text-[10.5px]">
                  {QUOTATION_ISSUER.address} &nbsp;|&nbsp; Ph: {QUOTATION_ISSUER.phones.join(", ")} &nbsp;|&nbsp;{" "}
                  {QUOTATION_ISSUER.email}
                </p>
              </td>
              <td className="border border-black p-0 align-top">
                <table className="w-full border-collapse">
                  <tbody>
                    {[
                      ["Estimate No.", q.estimateNo],
                      ["Date", q.date],
                      ["Place of supply", q.placeOfSupply || "-"],
                    ].map(([label, value]) => (
                      <tr key={label}>
                        <td className={cell}>{label}</td>
                        <td className={`${cell} font-bold`}>{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>

        <div className="mt-3 text-xs leading-relaxed">
          <p className="font-bold">To:</p>
          <p>{r.name}</p>
          <p>Ph: {r.phone}</p>
          {r.address ? <p className="whitespace-pre-line">{r.address}</p> : null}
        </div>
        <p className="mt-2 text-xs font-bold">Submitting quotation for supplying plants.</p>
        <p className="mb-2 text-xs">Dear Sir,</p>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse border border-black">
            <thead>
              <tr>
                <th className={head}>#</th>
                <th className={head}>Item Code</th>
                <th className={head}>Item name</th>
                <th className={head}>Size</th>
                <th className={head}>Qty.</th>
                <th className={head}>Unit Rate</th>
                <th className={head}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {q.lines.map((line) => (
                <tr key={line.no} className="break-inside-avoid">
                  <td className={`${cell} text-center`}>{line.no}</td>
                  <td className={`${cell} text-center`}>{line.itemCode || "-"}</td>
                  <td className={cell}>
                    {line.name}
                    {line.requested ? <span className="text-[10px] text-gray-600"> (requested)</span> : null}
                  </td>
                  <td className={`${cell} text-center`}>{line.size || "-"}</td>
                  <td className={`${cell} text-right`}>{formatQuantity(line.quantity)}</td>
                  <td className={`${cell} whitespace-nowrap text-right`}>{formatRate(line.rate)}</td>
                  <td className={`${cell} whitespace-nowrap text-right`}>{formatLineAmount(line)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <table className="mt-3 w-full break-inside-avoid border-collapse border border-black">
          <tbody>
            <tr>
              <td className="border border-black p-2 align-top text-xs leading-relaxed">
                <p>Estimate Amount in Words</p>
                <p className="mb-2 font-bold">{q.amountInWords}</p>
                <p>Description</p>
                {q.description.map((d, i) => (
                  <p key={d}>
                    {i + 1}. {d}
                  </p>
                ))}
              </td>
              <td className="w-[42%] border border-black p-0 align-top">
                <table className="w-full border-collapse">
                  <tbody>
                    <tr>
                      <td className={cell}>Total Cost of Goods</td>
                      <td className={`${cell} whitespace-nowrap text-right`}>{formatRupees(q.goodsTotal)}</td>
                    </tr>
                    {q.charges.map((c) => (
                      <tr key={c.label}>
                        <td className={cell}>{c.label}</td>
                        <td className={`${cell} whitespace-nowrap text-right`}>{chargeValue(c)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td className={`${cell} font-bold`}>Total</td>
                      <td className={`${cell} whitespace-nowrap text-right font-bold`}>{formatRupees(q.total)}</td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>

        <table className="mt-3 w-full break-inside-avoid border-collapse border border-black">
          <tbody>
            <tr>
              <td className="border border-black p-2 align-top text-xs leading-relaxed">
                <p className="font-bold">Terms and conditions</p>
                <p>Thanks for doing business with us!</p>
                {q.terms.map((t, i) => (
                  <p key={t}>
                    {i + 1}. {t}
                  </p>
                ))}
              </td>
              <td className="w-[42%] border border-black p-2 align-top text-xs">
                <p className="text-center font-bold">For {QUOTATION_ISSUER.name}</p>
                <p className="mt-10 text-center font-bold">Authorized Signatory</p>
                <p className="text-center">(Managing Partner)</p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }
);

export default QuotationDocument;
