using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

public class TelaDosGamesApp : Form
{
    private Process nodeProcess;
    private Label lblStatus;
    private Label lblLocalInfo;
    private Label lblVpnInfo;
    private Label lblPublicUrl;
    private Button btnOpenApp;
    private Button btnCopyLan;
    private Button btnCopyVpn;
    private Button btnCopyCloudflare;
    private TextBox txtLogs;

    // O app é aberto pelo localhost: o navegador só libera microfone e tela em HTTPS ou localhost
    private const string LocalAppUrl = "http://localhost:3000";

    // Links para amigos usam HTTPS (porta 8443) pelo mesmo motivo
    private string currentLanUrl = "";
    private string currentVpnUrl = "";
    private string currentPublicIpUrl = "";
    private string currentCloudflareUrl = "";
    private string currentSection = "";

    [STAThread]
    public static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new TelaDosGamesApp());
    }

    public TelaDosGamesApp()
    {
        InitializeComponent();
        // Inicia o servidor só depois da janela existir (BeginInvoke precisa do handle da janela)
        this.Shown += (s, e) => StartNodeServer();
    }

    // ===== Paleta gamer (a mesma do app e do site) =====
    private static readonly Color CBg = Color.FromArgb(11, 13, 20);        // #0b0d14
    private static readonly Color CPanel = Color.FromArgb(18, 21, 34);     // #121522
    private static readonly Color CRaised = Color.FromArgb(24, 28, 44);    // #181c2c
    private static readonly Color CLine = Color.FromArgb(37, 42, 64);      // #252a40
    private static readonly Color CText = Color.FromArgb(238, 240, 248);   // #eef0f8
    private static readonly Color CSoft = Color.FromArgb(169, 175, 198);   // #a9afc6
    private static readonly Color CMuted = Color.FromArgb(108, 115, 144);  // #6c7390
    private static readonly Color CHot = Color.FromArgb(255, 106, 43);     // #ff6a2b
    private static readonly Color CHot2 = Color.FromArgb(255, 61, 110);    // #ff3d6e
    private static readonly Color CCyan = Color.FromArgb(45, 226, 230);    // #2de2e6
    private static readonly Color CLime = Color.FromArgb(157, 255, 74);    // #9dff4a
    private static readonly Color CYellow = Color.FromArgb(255, 194, 61);  // #ffc23d
    private static readonly Color CInk = Color.FromArgb(18, 6, 10);        // #12060a

    // Bahnschrift vem no Windows 10/11; se faltar, usa Segoe UI
    private static readonly string DisplayFamily = HasFont("Bahnschrift") ? "Bahnschrift" : "Segoe UI";

    private static bool HasFont(string name)
    {
        foreach (FontFamily f in FontFamily.Families)
            if (string.Equals(f.Name, name, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    private static Font Display(float size, FontStyle style = FontStyle.Bold)
    {
        return new Font(DisplayFamily, size, style);
    }

    // Corta dois cantos opostos do controle (visual de menu de jogo)
    private static void CutCorners(Control c, int cut)
    {
        var path = new System.Drawing.Drawing2D.GraphicsPath();
        int w = c.Width, h = c.Height;
        path.AddPolygon(new Point[] {
            new Point(cut, 0), new Point(w, 0), new Point(w, h - cut),
            new Point(w - cut, h), new Point(0, h), new Point(0, cut)
        });
        c.Region = new Region(path);
    }

    private static Button MakeButton(string text, Rectangle bounds, Color back, Color fore, Color hover, Color border, float fontSize)
    {
        Button b = new Button();
        b.Text = text;
        b.Bounds = bounds;
        b.BackColor = back;
        b.ForeColor = fore;
        b.FlatStyle = FlatStyle.Flat;
        b.FlatAppearance.BorderSize = border == Color.Empty ? 0 : 1;
        if (border != Color.Empty) b.FlatAppearance.BorderColor = border;
        b.FlatAppearance.MouseOverBackColor = hover;
        b.FlatAppearance.MouseDownBackColor = hover;
        b.Font = Display(fontSize);
        b.Cursor = Cursors.Hand;
        b.UseCompatibleTextRendering = false;
        CutCorners(b, 9);
        return b;
    }

    [System.Runtime.InteropServices.DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    // Barra de título escura (Windows 10 20H1+ e 11). Em versões antigas a chamada só falha em silêncio.
    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        try
        {
            int on = 1;
            if (DwmSetWindowAttribute(this.Handle, 20, ref on, 4) != 0)
                DwmSetWindowAttribute(this.Handle, 19, ref on, 4);
            int caption = 0x00140D0B; // COLORREF (BGR) de #0b0d14, só no Windows 11
            DwmSetWindowAttribute(this.Handle, 35, ref caption, 4);
        }
        catch { }
    }

    // Adiciona um pedaço do título e devolve onde o próximo deve começar
    private int AddTitlePart(string text, Font font, Color color, int x, int y)
    {
        Label l = new Label();
        l.Text = text;
        l.Font = font;
        l.ForeColor = color;
        l.AutoSize = true;
        l.Padding = Padding.Empty;
        l.Margin = Padding.Empty;
        l.UseCompatibleTextRendering = false;
        l.BackColor = Color.Transparent;
        l.Location = new Point(x, y);
        this.Controls.Add(l);
        Size s = TextRenderer.MeasureText(text, font, Size.Empty, TextFormatFlags.NoPadding);
        return x + s.Width + 2;
    }

    private void InitializeComponent()
    {
        this.Text = "TelaDosGames • Central do anfitrião";
        this.ClientSize = new Size(640, 520);
        this.StartPosition = FormStartPosition.CenterScreen;
        this.FormBorderStyle = FormBorderStyle.FixedSingle;
        this.MaximizeBox = false;
        this.BackColor = CBg;
        this.ForeColor = CText;
        this.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
        this.DoubleBuffered = true;

        // Faixa neon no topo (degradê laranja → rosa)
        Panel stripe = new Panel();
        stripe.Bounds = new Rectangle(0, 0, 640, 3);
        stripe.Paint += (s, e) =>
        {
            using (var br = new System.Drawing.Drawing2D.LinearGradientBrush(stripe.ClientRectangle, CHot, CHot2, 0f))
                e.Graphics.FillRectangle(br, stripe.ClientRectangle);
        };
        this.Controls.Add(stripe);

        // Título "TELA dos GAMES": três pedaços lado a lado, com o "DOS" menor e em laranja
        int titleX = 18;
        titleX = AddTitlePart("TELA", Display(22f), CText, titleX, 14);
        titleX = AddTitlePart("DOS", Display(14f), CHot, titleX, 24);
        titleX = AddTitlePart("GAMES", Display(22f), CText, titleX, 14);

        Label lblKicker = new Label();
        lblKicker.Text = "// CENTRAL DO ANFITRIÃO";
        lblKicker.Font = Display(9f);
        lblKicker.ForeColor = CMuted;
        lblKicker.Location = new Point(titleX + 12, 27);
        lblKicker.AutoSize = true;
        this.Controls.Add(lblKicker);

        // Status
        lblStatus = new Label();
        lblStatus.Text = "● INICIANDO SERVIDOR E CONEXÕES...";
        lblStatus.Font = Display(10f);
        lblStatus.ForeColor = CYellow;
        lblStatus.Location = new Point(20, 56);
        lblStatus.AutoSize = true;
        this.Controls.Add(lblStatus);

        // Painel de conexões com barra lateral neon
        Panel pnlLinks = new Panel();
        pnlLinks.Bounds = new Rectangle(20, 84, 600, 102);
        pnlLinks.BackColor = CPanel;
        pnlLinks.BorderStyle = BorderStyle.None;
        pnlLinks.Paint += (s, e) =>
        {
            using (var br = new SolidBrush(CCyan)) e.Graphics.FillRectangle(br, 0, 0, 3, pnlLinks.Height);
            using (var pen = new Pen(CLine)) e.Graphics.DrawRectangle(pen, 0, 0, pnlLinks.Width - 1, pnlLinks.Height - 1);
        };

        lblLocalInfo = new Label();
        lblLocalInfo.Text = "🏠 IP do Roteador / Local: Detectando IP...";
        lblLocalInfo.ForeColor = CLime;
        lblLocalInfo.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
        lblLocalInfo.Location = new Point(16, 12);
        lblLocalInfo.AutoSize = true;
        pnlLinks.Controls.Add(lblLocalInfo);

        lblVpnInfo = new Label();
        lblVpnInfo.Text = "🛡️ IP Radmin VPN: Verificando adaptador VPN...";
        lblVpnInfo.ForeColor = CYellow;
        lblVpnInfo.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
        lblVpnInfo.Location = new Point(16, 40);
        lblVpnInfo.AutoSize = true;
        pnlLinks.Controls.Add(lblVpnInfo);

        lblPublicUrl = new Label();
        lblPublicUrl.Text = "🌐 Conexão Web / Cloudflare: Inicializando link 1 clique...";
        lblPublicUrl.ForeColor = CCyan;
        lblPublicUrl.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
        lblPublicUrl.Location = new Point(16, 68);
        lblPublicUrl.AutoSize = true;
        pnlLinks.Controls.Add(lblPublicUrl);

        this.Controls.Add(pnlLinks);

        // Botão principal: abrir o app
        btnOpenApp = MakeButton("▶  ABRIR APLICATIVO", new Rectangle(20, 198, 200, 44),
            CHot, CInk, Color.FromArgb(255, 127, 71), Color.Empty, 11f);
        btnOpenApp.Click += (s, e) => OpenAppInDesktopMode();
        this.Controls.Add(btnOpenApp);

        // Copiar IP do roteador
        btnCopyLan = MakeButton("🏠  COPIAR IP ROTEADOR", new Rectangle(230, 198, 190, 44),
            CRaised, CText, Color.FromArgb(32, 37, 58), CLine, 9.5f);
        btnCopyLan.Click += (s, e) => CopyToClipboard(currentLanUrl, "Link do IP do Roteador (Rede Local)");
        this.Controls.Add(btnCopyLan);

        // Copiar IP da VPN
        btnCopyVpn = MakeButton("🛡️  COPIAR IP VPN", new Rectangle(430, 198, 190, 44),
            CRaised, CText, Color.FromArgb(32, 37, 58), CLine, 9.5f);
        btnCopyVpn.Click += (s, e) => CopyToClipboard(!string.IsNullOrEmpty(currentVpnUrl) ? currentVpnUrl : currentLanUrl, "Link via Radmin VPN");
        this.Controls.Add(btnCopyVpn);

        // Copiar link público (Cloudflare)
        btnCopyCloudflare = MakeButton("⚡  COPIAR LINK PÚBLICO PRA GALERA (SEM ABRIR PORTAS)", new Rectangle(20, 252, 600, 40),
            CLime, CInk, Color.FromArgb(180, 255, 120), Color.Empty, 10f);
        btnCopyCloudflare.Click += (s, e) => CopyToClipboard(!string.IsNullOrEmpty(currentCloudflareUrl) ? currentCloudflareUrl : currentLanUrl, "Link Direto Cloudflare");
        this.Controls.Add(btnCopyCloudflare);

        // Log
        Label lblLogTitle = new Label();
        lblLogTitle.Text = "// LOG DO SERVIDOR";
        lblLogTitle.Font = Display(9f);
        lblLogTitle.ForeColor = CMuted;
        lblLogTitle.Location = new Point(20, 306);
        lblLogTitle.AutoSize = true;
        this.Controls.Add(lblLogTitle);

        txtLogs = new TextBox();
        txtLogs.Multiline = true;
        txtLogs.ReadOnly = true;
        txtLogs.ScrollBars = ScrollBars.Vertical;
        txtLogs.Bounds = new Rectangle(20, 328, 600, 172);
        txtLogs.BackColor = Color.FromArgb(7, 8, 13);
        txtLogs.ForeColor = CSoft;
        txtLogs.BorderStyle = BorderStyle.FixedSingle;
        txtLogs.Font = new Font("Consolas", 8.5f);
        this.Controls.Add(txtLogs);

        this.FormClosing += (s, e) => StopNodeServer();
    }

    private void StartNodeServer()
    {
        try
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string bundledNode = Path.Combine(baseDir, "node", "node.exe");

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.Arguments = "server.js";
            psi.WorkingDirectory = baseDir;

            if (File.Exists(bundledNode))
            {
                // Versão instalada: usa o Node que vem junto e guarda contas/certificados na pasta do usuário
                psi.FileName = bundledNode;
                string dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DiscordStream");
                Directory.CreateDirectory(dataDir);
                psi.EnvironmentVariables["DISCORD_STREAM_DATA"] = dataDir;
            }
            else
            {
                psi.FileName = "node.exe";
            }
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            // O Node escreve em UTF-8; sem isso acentos e emojis chegam corrompidos e o parse falha
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;

            nodeProcess = new Process();
            nodeProcess.StartInfo = psi;
            nodeProcess.EnableRaisingEvents = true;

            nodeProcess.OutputDataReceived += (s, e) =>
            {
                if (!string.IsNullOrEmpty(e.Data) && this.IsHandleCreated && !this.IsDisposed)
                {
                    this.BeginInvoke((MethodInvoker)delegate
                    {
                        AppendLog(e.Data);
                        ParseOutputLine(e.Data);
                    });
                }
            };

            nodeProcess.ErrorDataReceived += (s, e) =>
            {
                if (!string.IsNullOrEmpty(e.Data) && this.IsHandleCreated && !this.IsDisposed)
                {
                    this.BeginInvoke((MethodInvoker)delegate
                    {
                        AppendLog("[AVISO] " + e.Data);
                    });
                }
            };

            nodeProcess.Start();
            nodeProcess.BeginOutputReadLine();
            nodeProcess.BeginErrorReadLine();
        }
        catch (Exception ex)
        {
            MessageBox.Show("Não foi possível iniciar o Node.js: " + ex.Message, "Erro Fatal", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void ParseOutputLine(string line)
    {
        if (line.Contains("[HTTP] Servidor rodando") || line.Contains("CONEXÕES VIA IP"))
        {
            lblStatus.Text = "● SERVIDOR ONLINE • PRONTO PRA JOGAR";
            lblStatus.ForeColor = CLime;
        }

        // O servidor imprime cada bloco com um cabeçalho seguido das linhas "HTTP:" e "HTTPS:"
        if (line.Contains("[IP DO ROTEADOR")) currentSection = "lan";
        else if (line.Contains("[IP RADMIN VPN")) currentSection = "vpn";
        else if (line.Contains("(INTERNET)]")) currentSection = "public";
        else if (line.StartsWith("====")) currentSection = "";

        if (line.Contains("HTTPS: https://") && currentSection != "")
        {
            Match m = Regex.Match(line, @"https://\d+\.\d+\.\d+\.\d+:\d+");
            if (m.Success)
            {
                if (currentSection == "lan")
                {
                    currentLanUrl = m.Value;
                    lblLocalInfo.Text = "🏠 IP do Roteador / Local: " + currentLanUrl;
                }
                else if (currentSection == "vpn")
                {
                    currentVpnUrl = m.Value;
                    lblVpnInfo.Text = "🛡️ IP Radmin VPN: " + currentVpnUrl;
                    lblVpnInfo.ForeColor = CLime;
                }
                else if (currentSection == "public")
                {
                    currentPublicIpUrl = m.Value;
                    lblPublicUrl.Text = "🌐 IP Público: " + currentPublicIpUrl;
                    lblPublicUrl.ForeColor = CLime;
                }
            }
        }

        if (line.Contains("trycloudflare.com"))
        {
            Match m = Regex.Match(line, @"https://(?!api)[a-zA-Z0-9-]+\.trycloudflare\.com");
            if (m.Success)
            {
                currentCloudflareUrl = m.Value;
                if (string.IsNullOrEmpty(currentPublicIpUrl))
                {
                    lblPublicUrl.Text = "🌐 Link Direto Cloudflare: " + currentCloudflareUrl;
                }
                else
                {
                    lblPublicUrl.Text = "🌐 IP: " + currentPublicIpUrl + " | Web: " + currentCloudflareUrl;
                }
                lblPublicUrl.ForeColor = CLime;
            }
        }
    }

    private void OpenAppInDesktopMode()
    {
        string targetUrl = LocalAppUrl;

        // Tenta abrir no Microsoft Edge em modo Janela de App (sem barras de navegação)
        try
        {
            Process.Start("msedge.exe", "--app=" + targetUrl + " --window-size=1280,820");
            return;
        }
        catch { }

        // Fallback para Google Chrome em modo App
        try
        {
            Process.Start("chrome.exe", "--app=" + targetUrl + " --window-size=1280,820");
            return;
        }
        catch { }

        // Fallback para navegador padrão
        try
        {
            Process.Start(targetUrl);
        }
        catch (Exception ex)
        {
            MessageBox.Show("Não foi possível abrir o navegador: " + ex.Message);
        }
    }

    private void CopyToClipboard(string url, string label)
    {
        if (string.IsNullOrEmpty(url))
        {
            MessageBox.Show("O link ainda não está disponível. Aguarde o servidor terminar de iniciar.", label, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        string text = "🎮 Venha para a minha transmissão no TelaDosGames (" + label + ")!\n🔗 Clique no link para entrar direto: " + url;
        if (url.StartsWith("https://") && !url.Contains("trycloudflare.com"))
        {
            text += "\n(Se aparecer um aviso de certificado, clique em \"Avançado\" e depois em \"Continuar\".)";
        }

        Clipboard.SetText(text);
        MessageBox.Show("Convite copiado com sucesso!\n\nLink: " + url + "\n\nEnvie para seus amigos no WhatsApp ou Discord.", label, MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    private void AppendLog(string text)
    {
        if (txtLogs != null && !txtLogs.IsDisposed)
        {
            txtLogs.AppendText(text + Environment.NewLine);
        }
    }

    private void StopNodeServer()
    {
        try
        {
            if (nodeProcess != null && !nodeProcess.HasExited)
            {
                // /T encerra também os processos filhos (cloudflared.exe), que Kill() deixaria rodando
                ProcessStartInfo killInfo = new ProcessStartInfo("taskkill", "/PID " + nodeProcess.Id + " /T /F");
                killInfo.UseShellExecute = false;
                killInfo.CreateNoWindow = true;
                Process killer = Process.Start(killInfo);
                killer.WaitForExit(5000);

                if (!nodeProcess.HasExited)
                {
                    nodeProcess.Kill();
                }
            }
        }
        catch { }
    }
}
