import { loginAction } from './actions';

export default function LoginPage() {
  return (
    <div className="min-h-screen flex">
      {/* Brand Panel */}
      <aside className="hidden lg:flex lg:w-[45%] relative overflow-hidden bg-[#064e3b] flex-col px-[52px] py-[56px] text-white">
        <div
          className="absolute inset-0 pointer-events-none animate-in fade-in duration-[2000ms]"
          style={{
            backgroundImage: `
              radial-gradient(circle at 20% 10%, rgba(52,211,153,0.25), transparent 42%),
              radial-gradient(circle at 85% 85%, rgba(2,132,199,0.22), transparent 45%)
            `,
          }}
        />
        <div className="absolute -bottom-[140px] -right-[140px] w-[380px] h-[380px] rounded-full border border-white/10 pointer-events-none" />

        <div className="relative z-10 flex flex-col h-full">
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both">
            <div className="w-[66px] h-[66px] rounded-xl bg-white/10 border border-white/14 flex items-center justify-center">
              <img
                src="https://lh3.googleusercontent.com/d/1cTPhZUSGNhnud4LJyyuaA8Hc_ulDem-6"
                alt="INBIONUSA"
                className="max-h-[46px] max-w-[46px] object-contain"
              />
            </div>
          </div>
          <h1 className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-150 fill-mode-both text-[34px] font-extrabold leading-tight mt-6">
            INBIONUSA
          </h1>
          <p className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300 fill-mode-both text-[15px] text-white/70 mt-2 max-w-[340px] leading-relaxed">
            Quality Control System — Kelola mutu produk, inspeksi, dan sertifikasi dengan presisi.
          </p>
          <div className="mt-auto">
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-500 fill-mode-both text-[11px] text-white/38 tracking-wider">
              &copy; 2024 INBIONUSA &middot; Quality Control System v5.0
            </div>
          </div>
        </div>
      </aside>

      {/* Form Panel */}
      <main className="flex-1 flex items-center justify-center bg-white">
        <div className="animate-in fade-in duration-800 delay-200 fill-mode-both w-full max-w-[400px] px-8">
          <div className="text-center mb-10">
            <div className="lg:hidden w-14 h-14 rounded-xl bg-[#047857] flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold">Selamat Datang</h2>
            <p className="text-sm text-muted-foreground mt-1">Masuk ke Quality Control System</p>
          </div>

          <form action={loginAction} className="space-y-5">
            <div className="space-y-1.5">
              <label htmlFor="username" className="text-sm font-medium">Username</label>
              <input
                id="username" name="username" type="text" required autoFocus
                className="w-full h-11 px-4 rounded-lg border border-input bg-background text-sm
                  placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring
                  transition-all duration-150"
                placeholder="Masukkan username"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium">Password</label>
              <input
                id="password" name="password" type="password" required
                className="w-full h-11 px-4 rounded-lg border border-input bg-background text-sm
                  placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring
                  transition-all duration-150"
                placeholder="Masukkan password"
              />
            </div>
            <button
              type="submit"
              className="w-full h-11 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold
                transition-all duration-150 active:scale-[0.98] cursor-pointer"
            >
              Masuk
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
