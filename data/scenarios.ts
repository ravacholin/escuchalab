import React from 'react';
import { Level } from '../types';
import { 
    // Generic Icons
    MapPin, Hand, HelpCircle, AlertCircle, AlertTriangle, MessageCircle, Heart, Angry, Search, Smile, Zap, DollarSign, Frown, Scale, Star, ThumbsUp, ThumbsDown, Camera,
    // Scenario Specific Icons
    Coffee, Bed, Car, ShoppingBag, Train, Home, Pill, Plane, Utensils, Bus, School, Landmark, 
    Stethoscope, ShieldAlert, Briefcase, Wallet, Wrench, Dumbbell, Key, Scissors, Phone, Laptop,
    Palette, Gavel, FlaskConical, Globe, Wine, Mic, Brain, Tv, Drama, Ghost, Rocket, Megaphone, Sun, Umbrella, Music,
    // Action Icons
    Ticket, Receipt, Menu, Wifi, Clock, Lock, Thermometer, BriefcaseBusiness, UserPlus, FileWarning, Gift, Sparkles, AlertOctagon, Euro, CreditCard, Map, Flag, Download,
    // Missing Icons Fix
    Check, X, TrendingUp, CheckCircle, FileText, Ban, Apple, DoorOpen, Server, Lightbulb, BatteryLow, PieChart, Eye, Watch, GraduationCap,
    // New Additions
    Stamp, Popcorn, Building, HeartHandshake, Baby, Dog, Hammer, Film, BookOpen, Siren, Headphones, Guitar, Newspaper, Tent
} from 'lucide-react';

export interface ScenarioAction {
    label: string;
    value: string; // The specific prompt for the AI
    icon: React.ElementType;
}

export interface ScenarioContext {
    label: string;
    value: string; // The physical setting description
    icon: React.ElementType;
    actions: ScenarioAction[]; // CHILDREN ACTIONS specific to this place
}

export const SCENARIO_DATABASE: Record<Level, ScenarioContext[]> = {
    [Level.Initial]: [
        {
            label: "Cafetería / Restaurante",
            value: "Cafetería restaurante bar ruidoso servicio mesa",
            icon: Coffee,
            actions: [
                { label: "Pedir la Cuenta", value: "Cliente pide la cuenta y pregunta si aceptan tarjeta", icon: Receipt },
                { label: "Reclamar (Comida Fría)", value: "El plato ha llegado frío y el cliente pide cambiarlo", icon: AlertCircle },
                { label: "Preguntar Ingredientes", value: "Preguntar qué lleva un plato por alergia o gusto", icon: Menu },
                { label: "Pedir Recomendación", value: "No sabe qué pedir y pregunta al camarero qué es bueno", icon: HelpCircle },
                { label: "Pedir Mesa (Reserva)", value: "Llegar al local y preguntar si hay mesa libre para dos", icon: UserPlus },
                { label: "Pedir Agua/Pan", value: "Solicitar más agua, pan o servilletas", icon: Hand },
                { label: "Preguntar Ubicación Baño", value: "Preguntar educadamente dónde están los servicios", icon: MapPin },
                { label: "Pedir para Llevar", value: "Sobró comida y quiere una caja para llevársela", icon: ShoppingBag },
                { label: "Café con Leche", value: "Pedir un café específico (con leche, cortado, solo)", icon: Coffee },
                { label: "Error en la Cuenta", value: "Han cobrado algo que no han pedido", icon: AlertTriangle }
            ]
        },
        {
            label: "Mercado Callejero",
            value: "Mercado aire libre fruta verdura ruido regateo",
            icon: Apple,
            actions: [
                { label: "Preguntar Precio Kilo", value: "Preguntar a cuánto están las naranjas hoy", icon: DollarSign },
                { label: "Pedir Fruta Madura", value: "Pedir aguacates que estén listos para comer hoy", icon: Hand },
                { label: "Regatear (Básico)", value: "Intentar bajar el precio un poco de forma amable", icon: TrendingUp },
                { label: "Probar Producto", value: "Preguntar si se puede probar el queso antes de comprar", icon: Smile },
                { label: "Origen del Producto", value: "Preguntar si los tomates son de aquí o importados", icon: Globe },
                { label: "Pedir Cambio", value: "Solo tiene un billete grande y necesita cambio", icon: Euro },
                { label: "Bolsa Rota", value: "Se le ha roto la bolsa y pide otra", icon: ShoppingBag },
                { label: "Horario Mercado", value: "Preguntar qué días ponen el mercado", icon: Clock }
            ]
        },
        {
            label: "Cine / Taquilla",
            value: "Cine taquilla palomitas cola entrada",
            icon: Film,
            actions: [
                { label: "Comprar Entradas", value: "Dos entradas para la película de las 7", icon: Ticket },
                { label: "Elegir Asientos", value: "Prefiere sentarse en el pasillo o atrás", icon: UserPlus },
                { label: "Combo Palomitas", value: "Pedir palomitas grandes y bebida sin hielo", icon: Popcorn },
                { label: "Película Subtitulada", value: "Preguntar si la peli es en versión original o doblada", icon: MessageCircle },
                { label: "Sala Incorrecta", value: "Preguntar dónde está la sala 5", icon: HelpCircle },
                { label: "Descuento Estudiante", value: "Preguntar si hay descuento con carnet joven", icon: DollarSign }
            ]
        },
        {
            label: "Oficina de Correos",
            value: "Oficina correos paquete ventanilla cola",
            icon: Stamp,
            actions: [
                { label: "Enviar Paquete", value: "Quiere enviar una caja a otro país", icon: Rocket },
                { label: "Comprar Sellos", value: "Necesita sellos para unas postales", icon: Check },
                { label: "Recoger Paquete", value: "Trae un aviso de llegada para recoger algo", icon: FileText },
                { label: "Preguntar Plazos", value: "Preguntar cuánto tarda en llegar una carta ordinaria", icon: Clock },
                { label: "Rellenar Formulario", value: "Pedir ayuda para rellenar el impreso de envío", icon: HelpCircle },
                { label: "Paquete Pesado", value: "Preguntar cuánto cuesta por kilo", icon: Scale }
            ]
        },
        {
            label: "Estación de Tren/Bus",
            value: "Estación tren andén taquilla transporte público",
            icon: Train,
            actions: [
                { label: "Comprar Billete Ida", value: "Comprar un billete sencillo para el próximo tren", icon: Ticket },
                { label: "Preguntar Andén", value: "No encuentra su tren y pregunta de dónde sale", icon: HelpCircle },
                { label: "Reportar Objeto Perdido", value: "Ha perdido una mochila y pregunta en información", icon: Search },
                { label: "Cambiar Horario", value: "Quiere cambiar su billete para una hora más tarde", icon: Clock },
                { label: "Preguntar Retraso", value: "El tren no llega y pregunta cuánto falta", icon: AlertTriangle },
                { label: "Máquina Expendedora", value: "No sabe usar la máquina automática y pide ayuda", icon: Hand },
                { label: "Validar Ticket", value: "Preguntar dónde se pica o valida el billete", icon: Check },
                { label: "Asiento Reservado", value: "Alguien está sentado en su sitio y se lo indica", icon: UserPlus }
            ]
        },
        {
            label: "Biblioteca",
            value: "Biblioteca silencio libros estudio",
            icon: BookOpen,
            actions: [
                { label: "Hacerse Socio", value: "Quiere el carnet de la biblioteca", icon: UserPlus },
                { label: "Devolver Libro", value: "Entregar un libro prestado", icon: BookOpen },
                { label: "Wifi", value: "Preguntar cómo conectarse a la red", icon: Wifi },
                { label: "Buscar Libro", value: "No encuentra una novela en la estantería", icon: Search },
                { label: "Multa Retraso", value: "Preguntar cuánto tiene que pagar por el retraso", icon: DollarSign },
                { label: "Horario Sala", value: "Preguntar hasta qué hora se puede estudiar", icon: Clock }
            ]
        },
        {
            label: "Hotel (Recepción)",
            value: "Hotel lobby recepción turismo mostrador",
            icon: Bed,
            actions: [
                { label: "Hacer Check-in", value: "Llegada al hotel, dar pasaporte y recibir llave", icon: Key },
                { label: "Problema: Aire Acondicionado", value: "El aire o calefacción de la habitación no funciona", icon: Thermometer },
                { label: "Pedir Desayuno", value: "Preguntar horario y precio del desayuno", icon: Coffee },
                { label: "Pedir Taxi", value: "Solicitar que llamen a un taxi para ir al aeropuerto", icon: Car },
                { label: "Clave del Wifi", value: "Preguntar la contraseña de internet", icon: Wifi },
                { label: "Dejar Maletas", value: "Pedir guardar el equipaje después del check-out", icon: ShoppingBag },
                { label: "Pedir Toallas", value: "Faltan toallas en el baño y llama a recepción", icon: Hand },
                { label: "Despertador", value: "Pedir que le despierten a las 7:00 AM", icon: Clock }
            ]
        },
        {
            label: "En la Calle (Ciudad)",
            value: "Calle ciudad exterior tráfico ruido peatones",
            icon: Map,
            actions: [
                { label: "Preguntar Dirección", value: "Perdido, pregunta cómo llegar a la Plaza Mayor", icon: MapPin },
                { label: "Preguntar Hora", value: "Se le acabó la batería y pregunta la hora", icon: Clock },
                { label: "Buscar Metro", value: "Preguntar dónde está la boca de metro más cercana", icon: Train },
                { label: "Sacar una Foto", value: "Pedir a un extraño que le saque una foto", icon: Camera },
                { label: "Parada de Taxi", value: "Preguntar dónde se cogen los taxis", icon: Car },
                { label: "Calle Cortada", value: "Un policía indica que no se puede pasar por ahí", icon: AlertOctagon },
                { label: "Clima / Lluvia", value: "Comentario casual sobre que empieza a llover", icon: Umbrella }
            ]
        },
        {
            label: "Tienda de Ropa",
            value: "Tienda ropa centro comercial probadores",
            icon: ShoppingBag,
            actions: [
                { label: "Pedir Talla Diferente", value: "La prenda es pequeña, necesita una talla más grande", icon: Search },
                { label: "Devolución", value: "Quiere devolver algo que compró ayer", icon: Receipt },
                { label: "Preguntar Precio", value: "El artículo no tiene etiqueta y quiere saber cuánto cuesta", icon: DollarSign },
                { label: "Buscar Probadores", value: "Preguntar dónde se puede probar la ropa", icon: MapPin },
                { label: "Pagar (Caja)", value: "Pagar en efectivo y pedir bolsa", icon: Wallet },
                { label: "Color Diferente", value: "Preguntar si tienen esto mismo en azul", icon: Palette },
                { label: "Regalo", value: "Pedir ticket regalo o envolver para regalo", icon: Gift }
            ]
        },
        {
            label: "Farmacia",
            value: "Farmacia mostrador salud medicina",
            icon: Pill,
            actions: [
                { label: "Pedir Analgésico", value: "Le duele la cabeza y pide algo para el dolor", icon: Pill },
                { label: "Preguntar Dosis", value: "No sabe cuántas pastillas tomar al día", icon: HelpCircle },
                { label: "Comprar Mascarillas/Curitas", value: "Necesita material básico de primeros auxilios", icon: ShoppingBag },
                { label: "Consultar Síntoma Leve", value: "Tiene tos y pide jarabe", icon: Stethoscope },
                { label: "Crema Solar", value: "Pedir protección solar para la playa", icon: Sun },
                { label: "Horario de Guardia", value: "Preguntar qué farmacia está abierta de noche", icon: Clock }
            ]
        }
    ],
    [Level.Intermediate]: [
        {
            label: "Comisaría de Policía",
            value: "Comisaría policía oficina denuncias serio",
            icon: Siren,
            actions: [
                { label: "Denunciar Robo Cartera", value: "Explicar que le robaron la cartera en el metro", icon: Wallet },
                { label: "Pérdida de Pasaporte", value: "Necesita un justificante porque perdió el pasaporte", icon: FileText },
                { label: "Queja Ruido Vecinos", value: "Poner una denuncia por ruido excesivo", icon: Music },
                { label: "Testigo de Accidente", value: "Dar testimonio de un choque que vio en la calle", icon: Eye },
                { label: "Renovar DNI", value: "Preguntar qué papeles necesita para renovar identidad", icon: FileText },
                { label: "Multa Injusta", value: "Intentar recurrir una multa de tráfico", icon: AlertOctagon }
            ]
        },
        {
            label: "Soporte Técnico",
            value: "Oficina informática teléfono ordenadores cables",
            icon: Headphones,
            actions: [
                { label: "Internet no Funciona", value: "El router tiene luz roja y no hay wifi", icon: Wifi },
                { label: "Ordenador Lento", value: "Quejarse de que el PC va muy lento", icon: Laptop },
                { label: "Olvido de Contraseña", value: "Pedir restablecer la contraseña del correo", icon: Lock },
                { label: "Impresora Atascada", value: "Pedir ayuda porque el papel se atascó", icon: FileText },
                { label: "Virus Detectado", value: "Mensaje de alerta en pantalla y pánico", icon: ShieldAlert },
                { label: "Instalar Programa", value: "Necesita permisos para instalar software", icon: Download }
            ]
        },
        {
            label: "Cena con Amigos",
            value: "Restaurante cena amigos ambiente relajado risas",
            icon: Utensils,
            actions: [
                { label: "Dividir la Cuenta (Lío)", value: "Intentan pagar a escote pero las cuentas no salen y discuten", icon: DollarSign },
                { label: "Contar un Chisme", value: "Uno cuenta un secreto sobre una pareja que no está", icon: MessageCircle },
                { label: "Anunciar Noticia", value: "Alguien anuncia que se casa o se muda", icon: Sparkles },
                { label: "Debate sobre Comida", value: "Discusión amistosa sobre si la pizza lleva piña o no", icon: MessageCircle },
                { label: "Organizar Viaje", value: "Planean irse juntos de vacaciones el próximo mes", icon: Plane },
                { label: "Recordar Anécdota", value: "Hablar de algo divertido que les pasó hace años", icon: Smile },
                { label: "Cancelar Plan", value: "Uno dice que mañana no podrá ir al cine al final", icon: X },
                { label: "Pedir Consejo Amoroso", value: "Uno pide ayuda con su situación sentimental", icon: Heart }
            ]
        },
        {
            label: "Trabajo / Oficina",
            value: "Oficina trabajo reunión formal despacho",
            icon: Briefcase,
            actions: [
                { label: "Justificar Retraso", value: "Llega tarde y tiene que inventar una excusa creíble al jefe", icon: Clock },
                { label: "Pedir Aumento/Días", value: "Negociación tensa para pedir vacaciones o más dinero", icon: DollarSign },
                { label: "Explicar Error", value: "Ha cometido un fallo en un informe y lo confiesa", icon: AlertTriangle },
                { label: "Chisme Laboral", value: "Hablar mal de un compañero que no trabaja", icon: MessageCircle },
                { label: "Delegar Tarea", value: "Pedir a un compañero que haga tu trabajo por una urgencia", icon: Hand },
                { label: "Problema Informático", value: "El ordenador no va y llama al técnico enfadado", icon: Laptop },
                { label: "Organizar Reunión", value: "Intentar cuadrar agendas imposibles con un cliente", icon: Clock },
                { label: "Despedida Compañero", value: "Hablar sobre qué regalar al que se jubila", icon: Gift }
            ]
        },
        {
            label: "Agencia Inmobiliaria",
            value: "Oficina inmobiliaria fotos pisos planos mesa",
            icon: Building,
            actions: [
                { label: "Buscar Alquiler", value: "Describir qué tipo de piso busca y presupuesto", icon: Home },
                { label: "Queja de Vecinos", value: "Llamar a la agencia porque los vecinos hacen ruido", icon: Angry },
                { label: "Reclamar Fianza", value: "Exigir la devolución del depósito al dejar el piso", icon: DollarSign },
                { label: "Negociar Contrato", value: "Intentar cambiar una cláusula sobre mascotas", icon: Dog },
                { label: "Avería en Piso", value: "Reportar que se ha roto la caldera y es urgente", icon: Wrench },
                { label: "Visitar Piso", value: "Pedir cita para ver un apartamento", icon: Key }
            ]
        },
        {
            label: "Gimnasio",
            value: "Gimnasio pesas máquinas música eco sudor",
            icon: Dumbbell,
            actions: [
                { label: "Pedir Turno Máquina", value: "Preguntar cuánto le queda al otro en la máquina", icon: Clock },
                { label: "Explicar Ejercicio", value: "Uno explica al otro cómo hacer bien la sentadilla", icon: Hand },
                { label: "Queja de Higiene", value: "Alguien no usó toalla y dejó todo sudado", icon: Angry },
                { label: "Renovar Cuota", value: "Discutir en recepción porque cobraron de más", icon: DollarSign },
                { label: "Objetivos Año Nuevo", value: "Hablar de perder peso o ganar músculo", icon: TrendingUp },
                { label: "Clase de Zumba", value: "Comentar lo difícil que fue la clase de hoy", icon: Music }
            ]
        },
        {
            label: "Taller Mecánico",
            value: "Taller mecánico coches herramientas ruido grasa",
            icon: Wrench,
            actions: [
                { label: "Describir Ruido Raro", value: "El coche hace 'clac clac' al girar", icon: HelpCircle },
                { label: "Presupuesto Caro", value: "El mecánico da un precio muy alto y el cliente se queja", icon: DollarSign },
                { label: "Prisa por Arreglo", value: "Necesita el coche para mañana sin falta", icon: Clock },
                { label: "ITV (Revisión)", value: "Preguntar si el coche pasará la inspección técnica", icon: CheckCircle },
                { label: "Batería Muerta", value: "Explicar que el coche no arranca por la mañana", icon: Zap },
                { label: "Rueda Pinchada", value: "Pedir que arreglen un pinchazo rápido", icon: AlertOctagon }
            ]
        },
        {
            label: "Entrevista de Trabajo",
            value: "Despacho entrevista formal nervios curriculum",
            icon: HeartHandshake,
            actions: [
                { label: "Hablar de Defectos", value: "Responder a la pregunta 'cuál es tu mayor defecto'", icon: Frown },
                { label: "Negociar Salario", value: "Preguntar cuánto pagan sin parecer avaricioso", icon: DollarSign },
                { label: "Experiencia Pasada", value: "Explicar por qué dejó su último trabajo", icon: Briefcase },
                { label: "Preguntar Horario", value: "Saber si hay flexibilidad o teletrabajo", icon: Clock },
                { label: "Venderse", value: "Explicar por qué es el mejor candidato", icon: Star },
                { label: "Preguntas al Final", value: "Hacer preguntas inteligentes al entrevistador", icon: HelpCircle }
            ]
        },
        {
            label: "Veterinario",
            value: "Clínica veterinaria perro gato sala espera",
            icon: Dog,
            actions: [
                { label: "Gato no Come", value: "Explicar que la mascota está triste y no come", icon: Frown },
                { label: "Vacunación", value: "Preguntar qué vacunas tocan este año", icon: Stethoscope },
                { label: "Urgencia", value: "El perro se ha comido algo tóxico", icon: AlertTriangle },
                { label: "Corte de Pelo", value: "Pedir cita para peluquería canina", icon: Scissors },
                { label: "Factura Alta", value: "Sorprenderse por el precio de la operación", icon: DollarSign },
                { label: "Comportamiento", value: "El perro ladra mucho y pide consejo", icon: MessageCircle }
            ]
        },
        {
            label: "Banco / Finanzas",
            value: "Banco oficina cajero dinero silencio",
            icon: Landmark,
            actions: [
                { label: "Abrir Cuenta", value: "Preguntar requisitos y comisiones para abrir cuenta", icon: FileText },
                { label: "Préstamo Rechazado", value: "El director explica por qué no dan el crédito", icon: Ban },
                { label: "Tarjeta Robada", value: "Llamar para anular una tarjeta por robo", icon: CreditCard },
                { label: "Error en Cargo", value: "Reclamar un cobro que no reconoce en el extracto", icon: AlertTriangle },
                { label: "Transferencia Internacional", value: "Preguntar cómo enviar dinero al extranjero", icon: Globe }
            ]
        },
        {
            label: "Consulta Médica",
            value: "Hospital médico consulta privado silencio",
            icon: Stethoscope,
            actions: [
                { label: "Describir Dolor Raro", value: "Explicar un dolor difuso que va y viene", icon: Frown },
                { label: "Pedir Baja Laboral", value: "Intentar convencer al médico de que no puede trabajar", icon: BriefcaseBusiness },
                { label: "Miedo a Tratamiento", value: "El paciente tiene miedo a las agujas o la operación", icon: AlertCircle },
                { label: "Pedir Receta", value: "Necesita medicación crónica que se le acabó", icon: Pill },
                { label: "Dieta y Hábitos", value: "El médico regaña al paciente por comer mal", icon: Apple },
                { label: "Pedir Cita Especialista", value: "Quiere que le vea el dermatólogo", icon: UserPlus }
            ]
        },
        {
            label: "Peluquería",
            value: "Peluquería salón secadores tijeras espejo",
            icon: Scissors,
            actions: [
                { label: "Explicar Corte", value: "Explicar detalladamente cómo quiere el flequillo", icon: Hand },
                { label: "Resultado Desastroso", value: "No le gusta nada el corte y se queja sutilmente", icon: Frown },
                { label: "Charla Trivial", value: "Hablar del tiempo y vacaciones con el peluquero", icon: MessageCircle },
                { label: "Cambio de Look", value: "Quiere teñirse de un color radical", icon: Palette },
                { label: "Pedir Cita", value: "Llamar para reservar hora el sábado", icon: Phone }
            ]
        }
    ],
    [Level.Advanced]: [
         {
            label: "Backstage Concierto",
            value: "Backstage concierto camerino música ruido caos",
            icon: Guitar,
            actions: [
                { label: "Exigencias de Rider", value: "La estrella se queja de que el agua no es de la marca correcta", icon: Star },
                { label: "Fallo de Sonido", value: "Técnico discute con el manager por un acople", icon: Mic },
                { label: "Entrevista Express", value: "Periodista intenta sacar una declaración antes de salir", icon: MessageCircle },
                { label: "Nervios Pre-Show", value: "El cantante tiene pánico escénico", icon: Frown },
                { label: "Groupie Colado", value: "Seguridad echa a alguien que se ha colado", icon: Ban },
                { label: "Cambio de Setlist", value: "Discusión sobre qué canciones tocar", icon: FileText }
            ]
        },
        {
            label: "Redacción Periódico",
            value: "Redacción periodismo ordenadores estrés noticias",
            icon: Newspaper,
            actions: [
                { label: "Cambio de Portada", value: "El director cambia la noticia principal a última hora", icon: AlertTriangle },
                { label: "Fuente Anónima", value: "Discutir si la fuente es fiable o no", icon: ShieldAlert },
                { label: "Corrección de Errata", value: "Bronca por una falta de ortografía en el titular", icon: X },
                { label: "Entrevista Fallida", value: "El político ha cancelado la entrevista", icon: Phone },
                { label: "Fake News", value: "Debatir sobre si publicar un rumor viral", icon: Globe },
                { label: "Cierre de Edición", value: "Prisa máxima para enviar a imprenta", icon: Clock }
            ]
        },
        {
            label: "Start-up Tecnológica",
            value: "Oficina moderna start-up sofás pizarras inglés",
            icon: Rocket,
            actions: [
                { label: "Pitch a Inversores", value: "Vender la idea de la empresa usando jerga (growth, kpi)", icon: TrendingUp },
                { label: "Despido 'Cool'", value: "Despedir a alguien diciendo que es una 'oportunidad'", icon: DoorOpen },
                { label: "Crisis de Servidores", value: "La app se ha caído y hay pánico técnico", icon: Server },
                { label: "Brainstorming Absurdo", value: "Ideas ridículas que todos aplauden por compromiso", icon: Lightbulb },
                { label: "Burnout (Estrés)", value: "Confesar que está quemado de trabajar 15 horas", icon: BatteryLow },
                { label: "Negociar Equity", value: "Discutir qué porcentaje de la empresa se queda cada uno", icon: PieChart }
            ]
        },
        {
            label: "Juicio / Legal",
            value: "Juzgado tribunal sala legal serio eco",
            icon: Gavel,
            actions: [
                { label: "Interrogatorio Hostil", value: "Abogado presiona a un testigo para que confiese contradicciones", icon: Zap },
                { label: "Alegato de Inocencia", value: "Discurso emotivo defendiendo su honorabilidad", icon: Hand },
                { label: "Objeción Técnica", value: "Discusión sobre un tecnicismo legal aburrido pero crucial", icon: Scale },
                { label: "Negociar Acuerdo", value: "Intentar llegar a un pacto secreto antes del veredicto", icon: Lock },
                { label: "Mentira Descubierta", value: "El juez pilla al acusado en una mentira obvia", icon: AlertTriangle },
                { label: "Lectura de Sentencia", value: "El momento tenso donde se lee el veredicto final", icon: FileText }
            ]
        },
        {
            label: "Galería de Arte",
            value: "Museo galería arte moderno silencioso pasos",
            icon: Palette,
            actions: [
                { label: "Crítica Pretenciosa", value: "Usar lenguaje muy culto y vacío para criticar un cuadro", icon: Brain },
                { label: "Fingir Saber", value: "Alguien no entiende nada pero finge ser experto para impresionar", icon: Drama },
                { label: "Compra de Inversión", value: "Negociar la compra de una obra por millones (blanqueo sutil)", icon: DollarSign },
                { label: "Debate Ético", value: "Discusión sobre si el arte debe ser político o estético", icon: MessageCircle },
                { label: "Accidente con Obra", value: "Alguien toca una escultura y casi la rompe", icon: AlertOctagon },
                { label: "Explicar el Vacío", value: "Justificar por qué un lienzo en blanco es arte", icon: Eye }
            ]
        },
        {
            label: "Terapia Psicológica",
            value: "Consulta diván silencio reloj tic-tac íntimo",
            icon: Brain,
            actions: [
                { label: "Confesión Traumática", value: "Revelar un evento del pasado que nunca contó a nadie", icon: Lock },
                { label: "Resistencia al Cambio", value: "El paciente se enfada cuando el psicólogo le dice la verdad", icon: Angry },
                { label: "Análisis de Sueño", value: "Narración surrealista de un sueño y su interpretación", icon: Ghost },
                { label: "Ruptura Terapéutica", value: "El paciente decide dejar la terapia porque 'ya está bien'", icon: Hand },
                { label: "Transferencia", value: "El paciente confiesa estar enamorado del terapeuta", icon: Heart },
                { label: "Silencio Incómodo", value: "Nadie habla durante un minuto entero (tensión)", icon: Watch }
            ]
        },
        {
            label: "Entrevista Política/Radio",
            value: "Estudio radio entrevista micrófono tensión",
            icon: Mic,
            actions: [
                { label: "Evasión de Respuesta", value: "El político habla mucho sin responder la pregunta difícil", icon: MessageCircle },
                { label: "Ataque Personal", value: "El entrevistador saca un trapo sucio del pasado", icon: Zap },
                { label: "Discurso Populista", value: "Promesas grandilocuentes y retórica vacía", icon: Globe },
                { label: "Corte de Micrófono", value: "Tensión máxima, se interrumpe la entrevista abruptamente", icon: AlertTriangle },
                { label: "Primicia Exclusiva", value: "Revelar un escándalo en directo", icon: Megaphone },
                { label: "Debate a Gritos", value: "Dos tertulianos se gritan y no se entiende nada", icon: Frown }
            ]
        },
        {
            label: "Cata de Vinos / Lujo",
            value: "Bodega restaurante lujo copas vino silencio",
            icon: Wine,
            actions: [
                { label: "Descripción Sensorial", value: "Describir el sabor del vino con adjetivos imposibles (madera, cuero)", icon: Sparkles },
                { label: "Esnobismo Puro", value: "Mirar por encima del hombro al que pide cerveza", icon: Eye },
                { label: "Vino Picado", value: "Devolver una botella de 200€ porque sabe a corcho", icon: ThumbsDown },
                { label: "Maridaje Incorrecto", value: "El sommelier corrige al cliente por pedir pescado con tinto", icon: Hand },
                { label: "Brindis Hipócrita", value: "Brindar por el éxito de alguien a quien odias", icon: Smile }
            ]
        },
        {
            label: "Clase Universidad",
            value: "Aula magna universidad eco profesor alumnos",
            icon: School,
            actions: [
                { label: "Pregunta Pedante", value: "Alumno pregunta solo para demostrar que sabe más que el profe", icon: GraduationCap },
                { label: "Revisión de Examen", value: "Discutir una décima de nota en el despacho", icon: FileText },
                { label: "Plagio Detectado", value: "El profesor acusa al alumno de copiar el trabajo", icon: AlertTriangle },
                { label: "Debate Filosófico", value: "Discusión abstracta sobre la ética y la moral", icon: Scale },
                { label: "Explicación Compleja", value: "El profesor explica una teoría que nadie entiende", icon: Brain },
                { label: "Beca Rechazada", value: "El alumno pide explicaciones por no recibir la beca", icon: DollarSign }
            ]
        },
        {
            label: "Rodaje de Cine",
            value: "Set rodaje cámaras luces silencio acción",
            icon: Camera,
            actions: [
                { label: "Actor Diva", value: "El protagonista se niega a salir porque el café está frío", icon: Star },
                { label: "Director Enfadado", value: "Gritar 'Corten' porque nadie hace caso", icon: Megaphone },
                { label: "Fallo de Raccord", value: "Discutir porque el vaso estaba lleno y ahora vacío", icon: Search },
                { label: "Escena de Llanto", value: "Intentar llorar pero no sale, presión máxima", icon: Frown },
                { label: "Doble de Riesgo", value: "Negociar una escena peligrosa", icon: ShieldAlert },
                { label: "Lluvia Artificial", value: "Coordinar los efectos especiales que fallan", icon: Umbrella }
            ]
        },
        {
            label: "Comunidad de Vecinos",
            value: "Reunión vecinos portal escalera quejas",
            icon: Building,
            actions: [
                { label: "Derrama (Gasto Extra)", value: "Discutir porque hay que pagar el ascensor nuevo", icon: Euro },
                { label: "Ruidos Nocturnos", value: "Quejarse del vecino del 5º que toca la batería", icon: Music },
                { label: "Presidente Pesado", value: "Nadie quiere ser presidente de la comunidad", icon: UserPlus },
                { label: "Obras Ilegales", value: "Acusar a un vecino de cerrar la terraza sin permiso", icon: Hammer },
                { label: "Llaves del Portal", value: "La llave de abajo no funciona bien", icon: Key },
                { label: "Morosos", value: "Leer la lista de vecinos que no pagan", icon: FileWarning }
            ]
        },
        {
            label: "Maternidad / Paternidad",
            value: "Parque infantil bebés padres biberón",
            icon: Baby,
            actions: [
                { label: "Consejos No Pedidos", value: "Alguien critica cómo educas a tu hijo", icon: MessageCircle },
                { label: "Noches sin Dormir", value: "Competir por ver quién duerme menos", icon: Frown },
                { label: "Elegir Colegio", value: "Debate intenso sobre qué colegio es mejor", icon: School },
                { label: "Berrinche Público", value: "El niño llora en el súper y todos miran", icon: AlertCircle },
                { label: "Logros del Bebé", value: "Presumir de que su hijo ya camina o habla", icon: Star },
                { label: "Comida Orgánica", value: "Debate sobre si dar potitos o comida casera", icon: Apple }
            ]
        },
        {
            label: "Negociación de Paz",
            value: "Sala reuniones ONU banderas serio tensión",
            icon: Globe,
            actions: [
                { label: "Traducción Errónea", value: "Un error del traductor casi causa una guerra", icon: MessageCircle },
                { label: "Ultimátum", value: "Una parte da 24 horas para firmar", icon: Clock },
                { label: "Protocolo Roto", value: "Alguien se sienta donde no debe y ofende al otro", icon: ShieldAlert },
                { label: "Firma del Tratado", value: "Momento solemne de firmar la paz", icon: FileText },
                { label: "Espionaje", value: "Descubren un micro en la sala", icon: Mic }
            ]
        }
    ]
};