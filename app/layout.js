import "./globals.css";

export const metadata = {
  metadataBase: new URL("https://your-real-domain.com"), // your deployed URL
  title: "Gratitude Technologies | Inventory",
  description: "Inventory management for Gratitude Technologies",
  openGraph: {
    title: "Gratitude Technologies | Inventory",
    description: "Inventory management for Gratitude Technologies",
    url: "/",
    siteName: "Gratitude Technologies",
    type: "website",
    images: [{ url: "/gratitude-logo.jpeg", alt: "Gratitude Technologies logo" }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/gratitude-logo.jpeg"],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}