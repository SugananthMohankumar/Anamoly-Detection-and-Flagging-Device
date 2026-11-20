import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashMap;
import java.util.Map;

public class DashboardServer {

    private static final int PORT = 3000;
    private static final Map<String, String> MIME_TYPES = new HashMap<>();

    static {
        MIME_TYPES.put(".html", "text/html; charset=UTF-8");
        MIME_TYPES.put(".css", "text/css; charset=UTF-8");
        MIME_TYPES.put(".js", "application/javascript; charset=UTF-8");
        MIME_TYPES.put(".json", "application/json; charset=UTF-8");
        MIME_TYPES.put(".png", "image/png");
        MIME_TYPES.put(".jpg", "image/jpeg");
        MIME_TYPES.put(".jpeg", "image/jpeg");
        MIME_TYPES.put(".svg", "image/svg+xml");
        MIME_TYPES.put(".ico", "image/x-icon");
        MIME_TYPES.put(".onnx", "application/octet-stream");
        MIME_TYPES.put(".wasm", "application/wasm");
    }

    public static void main(String[] args) throws IOException {
        Path rootDir = Paths.get(".").toAbsolutePath().normalize();

        // Listen on localhost only (127.0.0.1:3000)
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", PORT), 0);
        server.createContext("/", new StaticFileHandler(rootDir));
        server.setExecutor(null); // default executor
        server.start();

        System.out.println("=====================================================");
        System.out.println("🚀 Anomaly Detector Dashboard (Java Server) is running!");
        System.out.println("👉 Open this URL in Chrome or Edge: http://localhost:" + PORT);
        System.out.println("=====================================================");
    }

    static class StaticFileHandler implements HttpHandler {
        private final Path rootDir;

        public StaticFileHandler(Path rootDir) {
            this.rootDir = rootDir;
        }

        @Override
        public void handle(HttpExchange exchange) throws IOException {
            try {
                String rawPath = exchange.getRequestURI().getPath();
                if (rawPath == null || rawPath.isEmpty()) {
                    rawPath = "/";
                }

                // Decode URL query / special characters
                String decodedPath = URLDecoder.decode(rawPath, StandardCharsets.UTF_8);

                // Default root "/" serves index.html
                if (decodedPath.equals("/")) {
                    decodedPath = "/index.html";
                }

                // Remove leading slash to resolve against rootDir
                String relativePath = decodedPath.startsWith("/") ? decodedPath.substring(1) : decodedPath;
                Path targetPath = rootDir.resolve(relativePath).normalize();

                // 403 Forbidden check: Prevent path traversal outside root project folder (e.g., /../)
                if (!targetPath.startsWith(rootDir)) {
                    sendTextResponse(exchange, 403, "403 Forbidden: Access denied");
                    return;
                }

                // 404 Not Found check
                if (!Files.exists(targetPath) || Files.isDirectory(targetPath)) {
                    sendTextResponse(exchange, 404, "404 Not Found");
                    return;
                }

                // Determine MIME type
                String fileName = targetPath.getFileName().toString().toLowerCase();
                String ext = "";
                int dotIdx = fileName.lastIndexOf('.');
                if (dotIdx >= 0) {
                    ext = fileName.substring(dotIdx);
                }
                String contentType = MIME_TYPES.getOrDefault(ext, "application/octet-stream");

                // Headers: Content-Type & Cache-Control: no-cache
                exchange.getResponseHeaders().set("Content-Type", contentType);
                exchange.getResponseHeaders().set("Cache-Control", "no-cache");

                byte[] fileBytes = Files.readAllBytes(targetPath);
                exchange.sendResponseHeaders(200, fileBytes.length);
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(fileBytes);
                }
            } catch (Exception ex) {
                // 500 Internal Server Error on file read or processing failure
                System.err.println("500 Server error handling request: " + ex.getMessage());
                sendTextResponse(exchange, 500, "500 Internal Server Error: " + ex.getMessage());
            }
        }

        private void sendTextResponse(HttpExchange exchange, int statusCode, String responseText) throws IOException {
            byte[] bytes = responseText.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "text/plain; charset=UTF-8");
            exchange.getResponseHeaders().set("Cache-Control", "no-cache");
            exchange.sendResponseHeaders(statusCode, bytes.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(bytes);
            }
        }
    }
}
