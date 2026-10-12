import "./globals.css";

export const metadata = {
  title: "Gratitude Technologies | Inventory",
  description: "Inventory management for Gratitude Technologies",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
