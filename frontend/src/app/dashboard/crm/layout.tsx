import styles from "./layout.module.css";

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return <div className={styles.scope}>{children}</div>;
}
