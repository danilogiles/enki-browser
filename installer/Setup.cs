// EnkiBrowserSetup.exe: installs Enki Browser for the current user, no administrator rights.
// The release zip is embedded as a resource, so this one file is the whole installer.
//
//   EnkiBrowserSetup.exe                 window with progress, opens the browser when done
//   EnkiBrowserSetup.exe /S              silent
//   EnkiBrowserSetup.exe /D=<folder>     install somewhere other than %LOCALAPPDATA%\Programs
//   EnkiBrowserSetup.exe /NoIntegration  no shortcuts or Apps entry (tests)
using System;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

static class Setup
{
    [STAThread]
    static int Main(string[] args)
    {
        bool silent = args.Any(a => a.Equals("/S", StringComparison.OrdinalIgnoreCase));
        bool integrate = !args.Any(a => a.Equals("/NoIntegration", StringComparison.OrdinalIgnoreCase));
        string d = args.FirstOrDefault(a => a.StartsWith("/D=", StringComparison.OrdinalIgnoreCase));
        string root = d != null ? Path.GetFullPath(d.Substring(3).Trim('"')) : Install.DefaultRoot;

        if (silent)
        {
            try { Run(root, integrate, _ => { }, s => { }); return 0; }
            catch (Exception e) { Console.Error.WriteLine(e.Message); return 1; }
        }

        Application.EnableVisualStyles();
        var form = new SetupForm();
        Exception failure = null;
        form.Shown += (s, e) => new Thread(() =>
        {
            try
            {
                if (Win.BrowserProcesses(root).Count > 0)
                {
                    var answer = (DialogResult)form.Invoke(new Func<DialogResult>(() => MessageBox.Show(form,
                        Win.T("O Enki Browser está aberto e será fechado para continuar.", "Enki Browser está abierto y se cerrará para continuar.", "Enki Browser is open and will be closed to continue."),
                        "Enki Browser", MessageBoxButtons.OKCancel, MessageBoxIcon.Information)));
                    if (answer != DialogResult.OK) { form.Invoke(new Action(form.Close)); return; }
                }
                Run(root, integrate, form.Progress, form.Status);
                form.Invoke(new Action(() => { form.Done = true; form.Close(); }));
            }
            catch (Exception ex)
            {
                failure = ex;
                form.Invoke(new Action(form.Close));
            }
        }) { IsBackground = true }.Start();
        Application.Run(form);

        if (failure != null)
        {
            MessageBox.Show(Win.T("Não foi possível instalar o Enki Browser:\n\n", "No se pudo instalar Enki Browser:\n\n", "Enki Browser could not be installed:\n\n") + failure.Message,
                "Enki Browser", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        if (form.Done) System.Diagnostics.Process.Start(Path.Combine(root, "EnkiBrowser.exe"));
        return form.Done ? 0 : 1;
    }

    static void Run(string root, bool integrate, Action<double> progress, Action<string> status)
    {
        status(Win.T("Preparando…", "Preparando…", "Preparing…"));
        Win.CloseBrowser(root);
        Directory.CreateDirectory(root);
        Install.RemoveLegacyLayout(root);

        status(Win.T("Instalando o Enki Browser…", "Instalando Enki Browser…", "Installing Enki Browser…"));
        string version;
        using (var payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
        {
            if (payload == null) throw new InvalidDataException("this installer has no payload");
            version = Install.ExtractRelease(payload, root, progress);
        }
        if (version == null || !File.Exists(Path.Combine(root, "app", version, "EnkiBrowserLauncher.exe")))
            throw new InvalidDataException("the installed files are incomplete");

        if (integrate)
        {
            status(Win.T("Criando atalhos…", "Creando accesos directos…", "Creating shortcuts…"));
            Install.CreateShortcuts(root);
            Install.Register(root, version, Install.FolderSizeKb(root));
        }
    }
}

sealed class SetupForm : Form
{
    readonly ProgressBar bar = new ProgressBar { Minimum = 0, Maximum = 1000, Style = ProgressBarStyle.Continuous };
    readonly Label status = new Label { AutoSize = false, TextAlign = ContentAlignment.MiddleLeft };
    public bool Done;

    public SetupForm()
    {
        Text = "Enki Browser";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(440, 180);
        BackColor = Color.FromArgb(6, 34, 56);
        ForeColor = Color.FromArgb(224, 242, 254);
        Font = new Font("Segoe UI", 10f);
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

        var logo = new PictureBox { Image = Icon != null ? Icon.ToBitmap() : null, SizeMode = PictureBoxSizeMode.Zoom, Bounds = new Rectangle(28, 28, 48, 48) };
        var title = new Label { Text = "Enki Browser", Font = new Font("Segoe UI Semibold", 15f), AutoSize = true, Location = new Point(88, 30) };
        var sub = new Label { Text = Win.T("Navegador privado com IA", "Navegador privado con IA", "Private browser with AI"), ForeColor = Color.FromArgb(134, 174, 203), AutoSize = true, Location = new Point(90, 60) };
        status.Bounds = new Rectangle(28, 100, 384, 24);
        bar.Bounds = new Rectangle(28, 130, 384, 10);
        Controls.AddRange(new Control[] { logo, title, sub, status, bar });
    }

    public void Progress(double p) { BeginInvoke(new Action(() => bar.Value = (int)Math.Round(Math.Max(0, Math.Min(1, p)) * 1000))); }
    public void Status(string s) { BeginInvoke(new Action(() => status.Text = s)); }
}
