import { Notice } from "@/components/ui/Notice";
import { Ambient } from "@/components/layout/Ambient";

export default function Placeholder({ title }: { title: string }) {
  return (<><Ambient /><Notice icon="lock" title={title} body="This area is built in a later phase." action={{ to: "/", label: "Back to houses" }} /></>);
}
