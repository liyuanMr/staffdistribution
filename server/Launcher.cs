// 轻量启动器：内置 dist 静态资源，启动本地 HTTP 服务并用系统默认浏览器打开。
// 不携带任何浏览器内核；编译依赖 Windows 自带的 .NET Framework 4.x。
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace StaffDistributionMap
{
    static class Program
    {
        static string webRoot;
        static string configFile;
        static readonly Dictionary<string, string> MimeTypes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { ".html", "text/html; charset=utf-8" },
            { ".js", "text/javascript; charset=utf-8" },
            { ".css", "text/css; charset=utf-8" },
            { ".json", "application/json; charset=utf-8" },
            { ".map", "application/json; charset=utf-8" },
            { ".png", "image/png" },
            { ".jpg", "image/jpeg" },
            { ".jpeg", "image/jpeg" },
            { ".gif", "image/gif" },
            { ".svg", "image/svg+xml" },
            { ".ico", "image/x-icon" },
            { ".woff", "font/woff" },
            { ".woff2", "font/woff2" },
            { ".ttf", "font/ttf" },
            { ".txt", "text/plain; charset=utf-8" }
        };

        [STAThread]
        static void Main(string[] args)
        {
            Console.OutputEncoding = Encoding.UTF8;
            Console.Title = "区域标注分布 - 本地服务";

            bool openBrowser = true;
            for (int i = 0; i < args.Length; i++)
            {
                if (string.Equals(args[i], "--no-browser", StringComparison.OrdinalIgnoreCase)) openBrowser = false;
            }

            try
            {
                PrepareWebRoot();

                string dataDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "StaffDistributionMap");
                Directory.CreateDirectory(dataDir);
                configFile = Path.Combine(dataDir, "region-config.json");

                int port;
                TcpListener listener = CreateListener(out port);
                string url = "http://127.0.0.1:" + port.ToString(CultureInfo.InvariantCulture) + "/";

                Console.WriteLine("区域标注分布 已启动");
                Console.WriteLine("访问地址：" + url);
                Console.WriteLine("配置文件：" + configFile);
                Console.WriteLine("关闭本窗口即停止服务。");
                Console.WriteLine();

                if (openBrowser)
                {
                    try
                    {
                        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine("未能自动打开浏览器，请手动访问上面的地址。");
                        Console.WriteLine(ex.Message);
                    }
                }

                while (true)
                {
                    TcpClient client = listener.AcceptTcpClient();
                    ThreadPool.QueueUserWorkItem(HandleClient, client);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("启动失败：" + ex.Message);
                Console.WriteLine(ex.ToString());
                Console.WriteLine();
                Console.WriteLine("按任意键退出...");
                try { Console.ReadKey(true); } catch { }
            }
        }

        // 优先使用固定端口：浏览器把主题、显示项等设置存在 localStorage 里，
        // localStorage 按「协议+主机+端口」隔离，端口每次都变会导致设置丢失。
        // 固定端口被占用时退回随机端口，保证仍能正常启动。
        static TcpListener CreateListener(out int port)
        {
            const int preferredPort = 17890;
            try
            {
                TcpListener fixedListener = new TcpListener(IPAddress.Loopback, preferredPort);
                fixedListener.Start();
                port = preferredPort;
                return fixedListener;
            }
            catch
            {
                TcpListener randomListener = new TcpListener(IPAddress.Loopback, 0);
                randomListener.Start();
                port = ((IPEndPoint)randomListener.LocalEndpoint).Port;
                return randomListener;
            }
        }

        // 把内置的 web.zip 解压到 LocalAppData，exe 更新后自动重新解压
        static void PrepareWebRoot()
        {
            string baseDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "StaffDistributionMap");
            webRoot = Path.Combine(baseDir, "web");
            Directory.CreateDirectory(baseDir);

            Assembly asm = Assembly.GetExecutingAssembly();
            using (Stream stream = asm.GetManifestResourceStream("web.zip"))
            {
                if (stream == null) throw new InvalidOperationException("未找到内置网页资源 web.zip");

                FileInfo exeInfo = new FileInfo(asm.Location);
                string stamp = exeInfo.Length.ToString(CultureInfo.InvariantCulture) + ":" +
                               exeInfo.LastWriteTimeUtc.Ticks.ToString(CultureInfo.InvariantCulture);
                string stampFile = Path.Combine(baseDir, "web.version");

                if (File.Exists(Path.Combine(webRoot, "index.html")) && File.Exists(stampFile))
                {
                    try
                    {
                        if (File.ReadAllText(stampFile).Trim() == stamp) return;
                    }
                    catch { }
                }

                Console.WriteLine("首次运行，正在释放内置网页（约需数秒）...");
                Directory.CreateDirectory(webRoot);
                string rootFull = Path.GetFullPath(webRoot) + Path.DirectorySeparatorChar;

                using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Read))
                {
                    foreach (ZipArchiveEntry entry in archive.Entries)
                    {
                        if (string.IsNullOrEmpty(entry.Name)) continue;
                        string dest = Path.GetFullPath(Path.Combine(webRoot, entry.FullName));
                        if (!dest.StartsWith(rootFull, StringComparison.OrdinalIgnoreCase)) continue;
                        string dir = Path.GetDirectoryName(dest);
                        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                        entry.ExtractToFile(dest, true);
                    }
                }

                File.WriteAllText(stampFile, stamp, new UTF8Encoding(false));
                Console.WriteLine("网页资源已就绪。");
            }
        }

        static void HandleClient(object state)
        {
            TcpClient client = state as TcpClient;
            if (client == null) return;

            try
            {
                client.ReceiveTimeout = 10000;
                client.SendTimeout = 30000;
                using (client)
                using (NetworkStream stream = client.GetStream())
                {
                    byte[] buffer = new byte[65536];
                    int total = 0;
                    int headerEnd = -1;

                    while (total < buffer.Length)
                    {
                        int n = stream.Read(buffer, total, buffer.Length - total);
                        if (n <= 0) return;
                        total += n;
                        headerEnd = FindHeaderEnd(buffer, total);
                        if (headerEnd >= 0) break;
                    }
                    if (headerEnd < 0)
                    {
                        WriteResponse(stream, 400, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Bad Request"), false, "no-store");
                        return;
                    }

                    string headerText = Encoding.ASCII.GetString(buffer, 0, headerEnd);
                    string[] lines = headerText.Split(new string[] { "\r\n" }, StringSplitOptions.None);
                    string[] requestLine = lines[0].Split(' ');
                    if (requestLine.Length < 2)
                    {
                        WriteResponse(stream, 400, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Bad Request"), false, "no-store");
                        return;
                    }

                    string method = requestLine[0].ToUpperInvariant();
                    string rawPath = requestLine[1];
                    int q = rawPath.IndexOf('?');
                    if (q >= 0) rawPath = rawPath.Substring(0, q);

                    int contentLength = 0;
                    for (int i = 1; i < lines.Length; i++)
                    {
                        int colon = lines[i].IndexOf(':');
                        if (colon > 0 && lines[i].Substring(0, colon).Trim().Equals("Content-Length", StringComparison.OrdinalIgnoreCase))
                        {
                            int.TryParse(lines[i].Substring(colon + 1).Trim(), out contentLength);
                        }
                    }

                    if (contentLength > 8 * 1024 * 1024)
                    {
                        WriteResponse(stream, 413, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Payload Too Large"), false, "no-store");
                        return;
                    }

                    byte[] body = new byte[contentLength];
                    int have = Math.Min(total - (headerEnd + 4), contentLength);
                    if (have > 0) Array.Copy(buffer, headerEnd + 4, body, 0, have);
                    int read = have;
                    while (read < contentLength)
                    {
                        int n = stream.Read(body, read, contentLength - read);
                        if (n <= 0) return;
                        read += n;
                    }

                    string path;
                    try { path = Uri.UnescapeDataString(rawPath); }
                    catch { path = rawPath; }

                    bool headOnly = method == "HEAD";
                    int status = 200;
                    string contentType = "application/octet-stream";
                    string cache = "no-store";
                    byte[] response;

                    if (string.Equals(path, "/api/region-config", StringComparison.OrdinalIgnoreCase))
                    {
                        if (method == "GET" || headOnly)
                        {
                            response = ReadConfigBytes();
                            contentType = "application/json; charset=utf-8";
                        }
                        else if (method == "POST")
                        {
                            try
                            {
                                string text = Encoding.UTF8.GetString(body);
                                JavaScriptSerializer serializer = new JavaScriptSerializer();
                                serializer.MaxJsonLength = 8 * 1024 * 1024;
                                object parsed = serializer.DeserializeObject(text);
                                if (!(parsed is IDictionary))
                                {
                                    throw new InvalidOperationException("配置必须为 JSON 对象");
                                }
                                string pretty = PrettyJson(parsed, 0);
                                File.WriteAllText(configFile, pretty, new UTF8Encoding(false));
                                response = Encoding.UTF8.GetBytes(pretty);
                                contentType = "application/json; charset=utf-8";
                            }
                            catch (Exception ex)
                            {
                                status = 400;
                                response = Encoding.UTF8.GetBytes("{\"error\":" + JsonQuote(ex.Message) + "}");
                                contentType = "application/json; charset=utf-8";
                            }
                        }
                        else
                        {
                            status = 405;
                            response = Encoding.UTF8.GetBytes("Method Not Allowed");
                            contentType = "text/plain; charset=utf-8";
                        }
                    }
                    else if (string.Equals(path, "/data/region-config.json", StringComparison.OrdinalIgnoreCase))
                    {
                        response = ReadConfigBytes();
                        contentType = "application/json; charset=utf-8";
                    }
                    else
                    {
                        if (path == "/" || path.Length == 0) path = "/index.html";
                        string relative = path.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
                        string full = null;
                        try { full = Path.GetFullPath(Path.Combine(webRoot, relative)); }
                        catch { full = null; }

                        string rootFull = Path.GetFullPath(webRoot) + Path.DirectorySeparatorChar;
                        if (full == null || !full.StartsWith(rootFull, StringComparison.OrdinalIgnoreCase))
                        {
                            status = 403;
                            response = Encoding.UTF8.GetBytes("Forbidden");
                            contentType = "text/plain; charset=utf-8";
                        }
                        else if (!File.Exists(full))
                        {
                            status = 404;
                            response = Encoding.UTF8.GetBytes("Not Found");
                            contentType = "text/plain; charset=utf-8";
                        }
                        else
                        {
                            response = File.ReadAllBytes(full);
                            string ext = Path.GetExtension(full);
                            string mime;
                            contentType = MimeTypes.TryGetValue(ext, out mime) ? mime : "application/octet-stream";
                            cache = (ext == ".html" || string.Equals(ext, ".json", StringComparison.OrdinalIgnoreCase))
                                ? "no-store"
                                : "public, max-age=3600";
                        }
                    }

                    WriteResponse(stream, status, contentType, response, headOnly, cache);
                }
            }
            catch
            {
                // 浏览器预连接、主动断开等场景直接忽略
            }
        }

        static int FindHeaderEnd(byte[] data, int length)
        {
            for (int i = 3; i < length; i++)
            {
                if (data[i - 3] == 13 && data[i - 2] == 10 && data[i - 1] == 13 && data[i] == 10)
                {
                    return i - 3;
                }
            }
            return -1;
        }

        static byte[] ReadConfigBytes()
        {
            try
            {
                if (File.Exists(configFile)) return File.ReadAllBytes(configFile);
            }
            catch { }

            string bundled = Path.Combine(webRoot, "data", "region-config.json");
            try
            {
                if (File.Exists(bundled)) return File.ReadAllBytes(bundled);
            }
            catch { }

            return Encoding.UTF8.GetBytes("{}");
        }

        static void WriteResponse(NetworkStream stream, int status, string contentType, byte[] body, bool headOnly, string cache)
        {
            string reason = "OK";
            if (status == 400) reason = "Bad Request";
            else if (status == 403) reason = "Forbidden";
            else if (status == 404) reason = "Not Found";
            else if (status == 405) reason = "Method Not Allowed";
            else if (status == 413) reason = "Payload Too Large";
            else if (status == 500) reason = "Internal Server Error";

            StringBuilder sb = new StringBuilder();
            sb.Append("HTTP/1.1 ").Append(status).Append(' ').Append(reason).Append("\r\n");
            sb.Append("Content-Type: ").Append(contentType).Append("\r\n");
            sb.Append("Content-Length: ").Append(body.Length).Append("\r\n");
            sb.Append("Cache-Control: ").Append(cache).Append("\r\n");
            sb.Append("X-Content-Type-Options: nosniff\r\n");
            sb.Append("Connection: close\r\n\r\n");

            byte[] head = Encoding.ASCII.GetBytes(sb.ToString());
            stream.Write(head, 0, head.Length);
            if (!headOnly && body.Length > 0) stream.Write(body, 0, body.Length);
            stream.Flush();
        }

        // 把保存的配置格式化成便于手工编辑的缩进 JSON
        static string PrettyJson(object value, int indent)
        {
            IDictionary dict = value as IDictionary;
            if (dict != null)
            {
                if (dict.Count == 0) return "{}";
                StringBuilder sb = new StringBuilder();
                sb.Append("{\n");
                bool first = true;
                foreach (DictionaryEntry kv in dict)
                {
                    if (!first) sb.Append(",\n");
                    first = false;
                    sb.Append(' ', (indent + 1) * 2);
                    sb.Append(JsonQuote(Convert.ToString(kv.Key, CultureInfo.InvariantCulture)));
                    sb.Append(": ");
                    sb.Append(PrettyJson(kv.Value, indent + 1));
                }
                sb.Append('\n');
                sb.Append(' ', indent * 2);
                sb.Append('}');
                return sb.ToString();
            }

            IList list = value as IList;
            if (list != null)
            {
                if (list.Count == 0) return "[]";
                StringBuilder sb = new StringBuilder();
                sb.Append("[\n");
                for (int i = 0; i < list.Count; i++)
                {
                    if (i > 0) sb.Append(",\n");
                    sb.Append(' ', (indent + 1) * 2);
                    sb.Append(PrettyJson(list[i], indent + 1));
                }
                sb.Append('\n');
                sb.Append(' ', indent * 2);
                sb.Append(']');
                return sb.ToString();
            }

            if (value == null) return "null";
            if (value is bool) return ((bool)value) ? "true" : "false";
            if (value is string) return JsonQuote((string)value);
            if (value is double)
            {
                double d = (double)value;
                if (double.IsNaN(d) || double.IsInfinity(d)) return "null";
                return d.ToString("R", CultureInfo.InvariantCulture);
            }
            if (value is float)
            {
                float f = (float)value;
                if (float.IsNaN(f) || float.IsInfinity(f)) return "null";
                return f.ToString("R", CultureInfo.InvariantCulture);
            }
            if (value is int || value is long || value is short || value is byte ||
                value is sbyte || value is uint || value is ulong || value is ushort || value is decimal)
            {
                return Convert.ToString(value, CultureInfo.InvariantCulture);
            }
            return JsonQuote(Convert.ToString(value, CultureInfo.InvariantCulture));
        }

        static string JsonQuote(string s)
        {
            if (s == null) return "null";
            StringBuilder sb = new StringBuilder(s.Length + 2);
            sb.Append('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < ' ') sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
            return sb.ToString();
        }
    }
}
