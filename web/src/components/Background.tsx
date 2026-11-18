/** 固定背景：渐变光斑 + 网格，制造层次感但不影响交互。 */
export function Background() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -top-[380px] left-1/2 h-[780px] w-[780px] -translate-x-[52%] rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.30),transparent_65%)] blur-[28px] dark:opacity-55" />
      <div className="absolute -right-[260px] top-[520px] h-[620px] w-[620px] rounded-full bg-[radial-gradient(circle,rgba(168,85,247,0.20),transparent_65%)] blur-[28px] dark:opacity-50" />
      <div className="absolute -bottom-[240px] -left-[180px] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(56,189,248,0.14),transparent_65%)] blur-[28px]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(120,130,170,0.07)_1px,transparent_1px),linear-gradient(to_bottom,rgba(120,130,170,0.07)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_80%_55%_at_50%_0%,#000_20%,transparent_75%)] dark:opacity-50" />
    </div>
  );
}
