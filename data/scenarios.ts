
import React from 'react';
import { Level, TextType } from '../types';
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
    Stamp, Popcorn, Building, HeartHandshake, Baby, Dog, Hammer, Film, BookOpen, Siren, Headphones, Guitar, Newspaper, Tent, Hash,
    ArrowRight, Calendar, Droplet, FireExtinguisher, Leaf, LineChart, ListChecks, Moon, PiggyBank, Recycle, Shirt, Ship, Trash2, TreePine, Truck
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

export const SCENARIO_DATABASE: Record<TextType, Record<Level, ScenarioContext[]>> = {
    [TextType.Dialogue]: {
        [Level.Intro]: [
            {
                label: "Datos de Contacto",
                value: "Intercambio de información personal social ruido ambiente",
                icon: Phone,
                actions: [
                    { label: "Número de WhatsApp", value: "Pedir y anotar un número de teléfono. UNO de los hablantes dicta los dígitos lentamente o agrupados.", icon: Hash },
                    { label: "Correo Electrónico", value: "Dictar un email complejo (arroba, punto, guion bajo).", icon: MessageCircle },
                    { label: "Usuario de Instagram", value: "Preguntar cómo aparece en redes sociales y deletrear el usuario.", icon: Search }
                ]
            },
            {
                label: "Recepción de Hotel",
                value: "Recepción hotel check-in formal mostrador",
                icon: Bed,
                actions: [
                    { label: "Deletrear Apellido", value: "El recepcionista no entiende el apellido y pide deletrearlo letra por letra.", icon: FileText },
                    { label: "Número de Habitación", value: "Asignar una habitación (ej: 304, 512) y dar instrucciones del piso.", icon: Key },
                    { label: "Horario Desayuno", value: "Informar de la hora exacta del desayuno (de 7:30 a 10:00).", icon: Clock }
                ]
            },
            {
                label: "Compras y Dinero",
                value: "Tienda caja pagar ruido supermercado",
                icon: Wallet,
                actions: [
                    { label: "Precio Exacto", value: "El cajero dice el total con céntimos (ej: 14,95€) y el cliente busca cambio.", icon: Euro },
                    { label: "Número de Zapato/Ropa", value: "Pedir una talla específica (38, 42, XL) y preguntar si hay.", icon: ShoppingBag },
                    { label: "Devolución (Días)", value: "Preguntar cuántos días hay para devolver (15 días, 30 días).", icon: Clock }
                ]
            },
            {
                label: "Transporte / Ciudad",
                value: "Calle taxi parada autobús ruido tráfico",
                icon: Car,
                actions: [
                    { label: "Dirección Exacta", value: "Decir al taxista la calle y el número exacto del portal.", icon: MapPin },
                    { label: "Número de Autobús", value: "Preguntar qué número de bus va al centro (el 24, el 132).", icon: Bus },
                    { label: "Distancia / Tiempo", value: "Preguntar cuánto falta (10 minutos, 5 kilómetros).", icon: Watch }
                ]
            },
            {
                label: "Citas y Agenda",
                value: "Oficina administración teléfono cita médica",
                icon: Clock,
                actions: [
                    { label: "Fecha de Nacimiento", value: "Dar la fecha de nacimiento para un formulario (día, mes, año).", icon: FileText },
                    { label: "Reservar Hora", value: "Acordar una cita para un día específico a una hora concreta.", icon: Clock },
                    { label: "Código Postal", value: "Dictar el código postal de la dirección.", icon: Hash }
                ]
            }
        ],
        [Level.Beginner]: [
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
    },
    [TextType.PodcastInterview]: {
        [Level.Intro]: [
            {
                label: "Podcast de Presentación",
                value: "Estudio podcast entrevista básica presentación personal",
                icon: Mic,
                actions: [
                    { label: "Saludo Inicial", value: "Saludar al público y presentar al invitado con frases cortas", icon: MessageCircle },
                    { label: "Nombre y País", value: "Decir nombre, ciudad y país de origen claramente", icon: Flag },
                    { label: "Hobby Favorito", value: "Hablar de un pasatiempo con vocabulario simple", icon: Smile },
                    { label: "Ocupación", value: "Explicar si estudia o trabaja y qué hace", icon: Briefcase },
                    { label: "Cierre y Despedida", value: "Cerrar el episodio con una despedida sencilla", icon: ThumbsUp }
                ]
            },
            {
                label: "Podcast de Comida",
                value: "Podcast culinario gustos básicos en cocina",
                icon: Coffee,
                actions: [
                    { label: "Comida Favorita", value: "Decir cuál es la comida favorita y por qué", icon: Heart },
                    { label: "No Me Gusta", value: "Explicar qué comida no le gusta y evitarla", icon: ThumbsDown },
                    { label: "Desayuno", value: "Contar qué desayuna normalmente", icon: Sun },
                    { label: "Recomendación", value: "Recomendar un plato típico fácil", icon: Menu },
                    { label: "Sabor Simple", value: "Describir si algo está dulce, salado o picante", icon: Smile }
                ]
            },
            {
                label: "Podcast de Rutina",
                value: "Entrevista sobre rutina diaria mañana tarde noche",
                icon: Clock,
                actions: [
                    { label: "Mañana", value: "Describir qué hace al levantarse", icon: Sun },
                    { label: "Trabajo/Estudio", value: "Explicar una actividad principal del día", icon: BookOpen },
                    { label: "Transporte", value: "Contar cómo va de casa al trabajo o escuela", icon: Bus },
                    { label: "Hora de Dormir", value: "Decir a qué hora se acuesta", icon: Moon },
                    { label: "Fin de Semana", value: "Mencionar un plan simple para el fin de semana", icon: Calendar }
                ]
            },
            {
                label: "Podcast de Lugares",
                value: "Podcast de ciudad lugares favoritos y paseo",
                icon: MapPin,
                actions: [
                    { label: "Lugar Favorito", value: "Presentar un lugar que le gusta en su ciudad", icon: MapPin },
                    { label: "Cómo Llegar", value: "Dar indicaciones básicas para llegar", icon: Map },
                    { label: "Por Qué Me Gusta", value: "Explicar una razón simple", icon: Heart },
                    { label: "Comparar Dos Lugares", value: "Decir cuál es mejor y por qué", icon: Scale },
                    { label: "Recomendación", value: "Invitar a visitarlo", icon: ThumbsUp }
                ]
            },
            {
                label: "Podcast de Compras",
                value: "Podcast sobre compras básicas en tienda",
                icon: ShoppingBag,
                actions: [
                    { label: "Última Compra", value: "Contar qué compró y cuándo", icon: Receipt },
                    { label: "Precio", value: "Decir cuánto costó y si es caro", icon: DollarSign },
                    { label: "Talla o Color", value: "Describir talla o color del producto", icon: Palette },
                    { label: "Consejo de Tienda", value: "Recomendar una tienda conocida", icon: ShoppingBag },
                    { label: "Experiencia", value: "Decir si la atención fue buena o mala", icon: Smile }
                ]
            }
        ],
        [Level.Beginner]: [
            {
                label: "Podcast de Viajes Cortos",
                value: "Entrevista sobre escapadas de fin de semana",
                icon: Plane,
                actions: [
                    { label: "Relatar el Viaje", value: "Contar un viaje breve con lugares visitados", icon: MapPin },
                    { label: "Transporte y Horario", value: "Explicar cómo viajó y a qué hora salió", icon: Train },
                    { label: "Recomendar Hotel", value: "Decir dónde se alojó y si fue cómodo", icon: Bed },
                    { label: "Problema Pequeño", value: "Contar un pequeño inconveniente y solución", icon: AlertCircle },
                    { label: "Consejo al Oyente", value: "Dar un consejo práctico para turistas", icon: ThumbsUp }
                ]
            },
            {
                label: "Podcast de Salud",
                value: "Podcast de bienestar y hábitos saludables",
                icon: Stethoscope,
                actions: [
                    { label: "Rutina de Ejercicio", value: "Describir una rutina simple de ejercicio", icon: Dumbbell },
                    { label: "Hábitos", value: "Contar un hábito saludable diario", icon: Heart },
                    { label: "Visita Médica", value: "Explicar una visita médica reciente", icon: Stethoscope },
                    { label: "Descanso", value: "Dar un consejo para dormir mejor", icon: Moon },
                    { label: "Dieta", value: "Comentar un cambio sencillo en la alimentación", icon: Apple }
                ]
            },
            {
                label: "Podcast de Trabajo",
                value: "Entrevista sobre trabajo cotidiano en oficina",
                icon: Briefcase,
                actions: [
                    { label: "Mi Puesto", value: "Describir el puesto y tareas principales", icon: Briefcase },
                    { label: "Tarea Difícil", value: "Contar una tarea que costó hacer", icon: AlertTriangle },
                    { label: "Reunión", value: "Describir una reunión breve y su resultado", icon: UserPlus },
                    { label: "Ambiente Laboral", value: "Explicar cómo es el ambiente con compañeros", icon: Smile },
                    { label: "Consejo Productividad", value: "Dar un consejo simple para organizarse", icon: Clock }
                ]
            },
            {
                label: "Podcast de Tecnología",
                value: "Podcast sobre tecnología cotidiana y apps",
                icon: Laptop,
                actions: [
                    { label: "App Favorita", value: "Explicar qué app usa más y para qué", icon: Phone },
                    { label: "Problema con el Móvil", value: "Contar un fallo reciente y cómo lo resolvió", icon: AlertCircle },
                    { label: "Seguridad Básica", value: "Dar un consejo para proteger contraseñas", icon: Lock },
                    { label: "Comparar Dispositivos", value: "Comparar dos móviles de forma simple", icon: Scale },
                    { label: "Recomendar Compra", value: "Recomendar un dispositivo económico", icon: DollarSign }
                ]
            },
            {
                label: "Podcast de Ocio",
                value: "Podcast de ocio cultura y planes",
                icon: Music,
                actions: [
                    { label: "Recomendar Película", value: "Contar una película reciente y por qué gusta", icon: Film },
                    { label: "Concierto", value: "Describir un concierto y el ambiente", icon: Music },
                    { label: "Libro", value: "Hablar de un libro fácil de leer", icon: BookOpen },
                    { label: "Plan del Fin de Semana", value: "Sugerir un plan simple para el finde", icon: Calendar },
                    { label: "Invitar a Evento", value: "Invitar al público a un evento local", icon: Ticket }
                ]
            },
            {
                label: "Podcast de Relaciones",
                value: "Podcast sobre amistades y vida social",
                icon: Heart,
                actions: [
                    { label: "Cómo nos Conocimos", value: "Contar cómo conoció a un amigo", icon: UserPlus },
                    { label: "Planear Salida", value: "Organizar una salida con amigos", icon: MapPin },
                    { label: "Malentendido", value: "Narrar un malentendido y cómo se arregló", icon: AlertTriangle },
                    { label: "Consejo Amoroso", value: "Dar un consejo simple sobre relaciones", icon: Heart },
                    { label: "Describir Personalidad", value: "Describir a alguien con adjetivos básicos", icon: Smile }
                ]
            }
        ],
        [Level.Intermediate]: [
            {
                label: "Podcast de Emprendimiento",
                value: "Entrevista sobre emprendimiento y negocios",
                icon: TrendingUp,
                actions: [
                    { label: "Motivación", value: "Explicar por qué decidió emprender", icon: Lightbulb },
                    { label: "Producto o Servicio", value: "Describir la propuesta de valor", icon: Briefcase },
                    { label: "Financiación", value: "Contar cómo consiguió financiación", icon: DollarSign },
                    { label: "Reto Legal", value: "Relatar un problema legal o burocrático", icon: FileText },
                    { label: "Lección Aprendida", value: "Compartir un aprendizaje clave", icon: Star }
                ]
            },
            {
                label: "Podcast de Educación",
                value: "Entrevista sobre educación y aprendizaje",
                icon: School,
                actions: [
                    { label: "Comparar Sistemas", value: "Comparar dos sistemas educativos", icon: Scale },
                    { label: "Experiencia Universitaria", value: "Contar una experiencia relevante", icon: GraduationCap },
                    { label: "Métodos de Enseñanza", value: "Debatir sobre métodos tradicionales y modernos", icon: Brain },
                    { label: "Propuesta de Mejora", value: "Proponer una mejora concreta", icon: Lightbulb },
                    { label: "Profesor Inspirador", value: "Narrar la historia de un profesor", icon: Heart }
                ]
            },
            {
                label: "Podcast Ambiental",
                value: "Podcast de medio ambiente y sostenibilidad",
                icon: Leaf,
                actions: [
                    { label: "Problema Local", value: "Describir un problema ambiental local", icon: AlertTriangle },
                    { label: "Acción Comunitaria", value: "Explicar una iniciativa ciudadana", icon: UserPlus },
                    { label: "Dato Impactante", value: "Compartir una cifra relevante", icon: PieChart },
                    { label: "Soluciones", value: "Debatir soluciones posibles", icon: Lightbulb },
                    { label: "Consejo Personal", value: "Dar un consejo sostenible", icon: Recycle }
                ]
            },
            {
                label: "Podcast de Cultura",
                value: "Podcast sobre cultura y sociedad",
                icon: Palette,
                actions: [
                    { label: "Cambio Cultural", value: "Describir un cambio cultural reciente", icon: Globe },
                    { label: "Tradición Familiar", value: "Contar una tradición familiar", icon: Heart },
                    { label: "Choque Cultural", value: "Narrar un choque cultural vivido", icon: AlertCircle },
                    { label: "Debate Generacional", value: "Comparar puntos de vista entre generaciones", icon: Scale },
                    { label: "Ejemplo de Inclusión", value: "Contar un ejemplo de inclusión", icon: ThumbsUp }
                ]
            },
            {
                label: "Podcast de Ciencia Popular",
                value: "Podcast divulgativo con lenguaje claro",
                icon: FlaskConical,
                actions: [
                    { label: "Hallazgo", value: "Explicar un hallazgo científico reciente", icon: Sparkles },
                    { label: "Mitos", value: "Desmentir un mito común", icon: X },
                    { label: "Preguntas de Oyentes", value: "Responder preguntas frecuentes", icon: MessageCircle },
                    { label: "Riesgos", value: "Analizar riesgos y beneficios", icon: AlertTriangle },
                    { label: "Recomendar Fuentes", value: "Sugerir fuentes confiables", icon: BookOpen }
                ]
            },
            {
                label: "Podcast de Finanzas",
                value: "Podcast de finanzas personales",
                icon: Landmark,
                actions: [
                    { label: "Presupuesto", value: "Explicar cómo organiza el presupuesto", icon: PieChart },
                    { label: "Ahorro", value: "Contar una estrategia de ahorro", icon: PiggyBank },
                    { label: "Error Financiero", value: "Narrar un error y lo aprendido", icon: AlertTriangle },
                    { label: "Inversión Básica", value: "Explicar una inversión sencilla", icon: TrendingUp },
                    { label: "Meta Económica", value: "Definir una meta financiera clara", icon: Star }
                ]
            },
            {
                label: "Podcast de Deportes",
                value: "Podcast de deportes y rendimiento",
                icon: Dumbbell,
                actions: [
                    { label: "Preparación", value: "Explicar cómo se prepara para competir", icon: Clock },
                    { label: "Recuperación", value: "Hablar de recuperación tras lesión", icon: Stethoscope },
                    { label: "Disciplina", value: "Describir disciplina mental y hábitos", icon: Brain },
                    { label: "Análisis de Partido", value: "Analizar un partido con detalle", icon: Tv },
                    { label: "Rutina de Entrenamiento", value: "Narrar una rutina semanal", icon: Dumbbell }
                ]
            }
        ],
        [Level.Advanced]: [
            {
                label: "Podcast de Investigación",
                value: "Entrevista de investigación periodística",
                icon: Newspaper,
                actions: [
                    { label: "Revelación", value: "Presentar una revelación relevante", icon: Megaphone },
                    { label: "Metodología", value: "Explicar métodos de investigación", icon: Search },
                    { label: "Fuentes", value: "Citar fuentes confidenciales sin exponerlas", icon: ShieldAlert },
                    { label: "Dilema Ético", value: "Discutir un dilema ético", icon: Scale },
                    { label: "Impacto", value: "Analizar impacto social", icon: Globe }
                ]
            },
            {
                label: "Podcast de Geopolítica",
                value: "Podcast de análisis geopolítico",
                icon: Globe,
                actions: [
                    { label: "Conflicto", value: "Analizar un conflicto actual", icon: AlertTriangle },
                    { label: "Acuerdos", value: "Interpretar acuerdos internacionales", icon: FileText },
                    { label: "Sanciones", value: "Explicar el efecto de sanciones", icon: Ban },
                    { label: "Escenarios", value: "Proyectar escenarios futuros", icon: Eye },
                    { label: "Consecuencias", value: "Evaluar consecuencias regionales", icon: Map }
                ]
            },
            {
                label: "Podcast de Filosofía",
                value: "Podcast de filosofía y ética",
                icon: Brain,
                actions: [
                    { label: "Dilema Moral", value: "Plantear un dilema moral complejo", icon: Scale },
                    { label: "Concepto", value: "Definir un concepto abstracto", icon: FileText },
                    { label: "Comparar Corrientes", value: "Comparar corrientes filosóficas", icon: BookOpen },
                    { label: "Responder Crítica", value: "Responder a una crítica fuerte", icon: Zap },
                    { label: "Conclusión", value: "Cerrar con una conclusión matizada", icon: ThumbsUp }
                ]
            },
            {
                label: "Podcast de Economía",
                value: "Podcast de economía y mercados",
                icon: PieChart,
                actions: [
                    { label: "Inflación", value: "Explicar causas de la inflación", icon: TrendingUp },
                    { label: "Tendencias", value: "Analizar tendencias del mercado", icon: LineChart },
                    { label: "Política Fiscal", value: "Debatir sobre política fiscal", icon: Landmark },
                    { label: "Consejo Empresarial", value: "Dar consejos a emprendedores", icon: Briefcase },
                    { label: "Lectura de Datos", value: "Interpretar datos económicos", icon: FileText }
                ]
            },
            {
                label: "Podcast de Arte",
                value: "Podcast de crítica artística",
                icon: Palette,
                actions: [
                    { label: "Analizar Obra", value: "Analizar una obra con lenguaje experto", icon: Eye },
                    { label: "Comparar Artistas", value: "Comparar estilos y corrientes", icon: Scale },
                    { label: "Mercado del Arte", value: "Hablar del mercado y coleccionismo", icon: DollarSign },
                    { label: "Censura", value: "Discutir casos de censura artística", icon: Ban },
                    { label: "Defender Postura", value: "Defender una postura crítica", icon: MessageCircle }
                ]
            },
            {
                label: "Podcast de Ciencia",
                value: "Podcast de ciencia y tecnología avanzada",
                icon: Rocket,
                actions: [
                    { label: "Avance Científico", value: "Explicar un avance reciente", icon: Sparkles },
                    { label: "Riesgos Éticos", value: "Analizar riesgos éticos", icon: AlertTriangle },
                    { label: "Visión de Futuro", value: "Proyectar el impacto futuro", icon: Eye },
                    { label: "Aplicación Práctica", value: "Describir aplicaciones reales", icon: Wrench },
                    { label: "Objeciones", value: "Responder objeciones críticas", icon: Zap }
                ]
            },
            {
                label: "Podcast de Crimen",
                value: "Podcast de crónica criminal",
                icon: ShieldAlert,
                actions: [
                    { label: "Narrar Caso", value: "Narrar un caso con detalle", icon: FileText },
                    { label: "Investigación", value: "Explicar pasos de investigación policial", icon: Search },
                    { label: "Víctimas", value: "Hablar del impacto en las víctimas", icon: Heart },
                    { label: "Debate Justicia", value: "Debatir la respuesta judicial", icon: Gavel },
                    { label: "Cierre Reflexivo", value: "Cerrar con reflexión crítica", icon: Brain }
                ]
            },
            {
                label: "Podcast de Psicología",
                value: "Podcast de psicología profunda",
                icon: Brain,
                actions: [
                    { label: "Explicar Trauma", value: "Explicar un trauma y su tratamiento", icon: Heart },
                    { label: "Análisis de Conducta", value: "Analizar un patrón de conducta", icon: Eye },
                    { label: "Relato Terapéutico", value: "Narrar un caso con empatía", icon: MessageCircle },
                    { label: "Consejo Profesional", value: "Dar un consejo profesional", icon: Stethoscope },
                    { label: "Mitos", value: "Desmentir mitos comunes", icon: X }
                ]
            }
        ]
    },
    [TextType.RadioNews]: {
        [Level.Intro]: [
            {
                label: "Boletín del Tiempo",
                value: "Radio local reporte del clima sencillo",
                icon: Sun,
                actions: [
                    { label: "Temperatura", value: "Decir la temperatura actual", icon: Thermometer },
                    { label: "Pronóstico Mañana", value: "Indicar el clima de mañana", icon: Sun },
                    { label: "Aviso de Lluvia", value: "Avisar que lloverá", icon: Umbrella },
                    { label: "Consejo Ropa", value: "Recomendar llevar abrigo o paraguas", icon: Shirt },
                    { label: "Hora del Reporte", value: "Decir la hora exacta del reporte", icon: Clock }
                ]
            },
            {
                label: "Tráfico Local",
                value: "Boletín de tráfico en la ciudad",
                icon: Car,
                actions: [
                    { label: "Atasco", value: "Reportar un atasco en una calle", icon: AlertTriangle },
                    { label: "Ruta Alternativa", value: "Dar una ruta alternativa sencilla", icon: Map },
                    { label: "Calle Cerrada", value: "Anunciar un cierre temporal", icon: AlertOctagon },
                    { label: "Tiempo Estimado", value: "Decir cuánto tarda el trayecto", icon: Clock },
                    { label: "Consejo Transporte", value: "Sugerir usar bus o metro", icon: Bus }
                ]
            },
            {
                label: "Noticias de Escuela",
                value: "Boletín escolar para estudiantes",
                icon: School,
                actions: [
                    { label: "Actividad", value: "Anunciar una actividad escolar", icon: Flag },
                    { label: "Examen", value: "Recordar fecha de examen", icon: FileText },
                    { label: "Evento Deportivo", value: "Anunciar partido del colegio", icon: Dumbbell },
                    { label: "Cambio Horario", value: "Informar cambio de horario", icon: Clock },
                    { label: "Mensaje Dirección", value: "Dar un mensaje de la dirección", icon: MessageCircle }
                ]
            },
            {
                label: "Servicios de la Ciudad",
                value: "Radio municipal avisos básicos",
                icon: Building,
                actions: [
                    { label: "Basura", value: "Avisar cambio de horario de basura", icon: Trash2 },
                    { label: "Corte de Agua/Luz", value: "Anunciar corte temporal", icon: AlertCircle },
                    { label: "Horario Biblioteca", value: "Informar horario de la biblioteca", icon: BookOpen },
                    { label: "Campaña Limpieza", value: "Anunciar campaña de limpieza", icon: Sparkles },
                    { label: "Teléfono de Información", value: "Dar un número de contacto", icon: Phone }
                ]
            },
            {
                label: "Agenda Cultural",
                value: "Boletín cultural con eventos simples",
                icon: Ticket,
                actions: [
                    { label: "Concierto", value: "Anunciar un concierto local", icon: Music },
                    { label: "Museo Gratis", value: "Informar día gratis en museo", icon: Palette },
                    { label: "Feria", value: "Invitar a una feria en la plaza", icon: MapPin },
                    { label: "Hora y Lugar", value: "Dar hora y lugar del evento", icon: Clock },
                    { label: "Invitación", value: "Animar a asistir", icon: ThumbsUp }
                ]
            }
        ],
        [Level.Beginner]: [
            {
                label: "Noticias Locales",
                value: "Radio local noticia del barrio",
                icon: Newspaper,
                actions: [
                    { label: "Incidente Menor", value: "Contar un incidente menor en el barrio", icon: AlertTriangle },
                    { label: "Declaración Breve", value: "Leer una declaración corta", icon: MessageCircle },
                    { label: "Datos Básicos", value: "Dar datos básicos (lugar, hora)", icon: Clock },
                    { label: "Estado Actual", value: "Decir cómo está la situación ahora", icon: CheckCircle },
                    { label: "Recomendación", value: "Dar una recomendación al público", icon: ThumbsUp }
                ]
            },
            {
                label: "Deportes de Barrio",
                value: "Boletín deportivo local",
                icon: Dumbbell,
                actions: [
                    { label: "Resultado", value: "Dar el resultado de un partido", icon: Star },
                    { label: "Jugador Destacado", value: "Mencionar a un jugador destacado", icon: ThumbsUp },
                    { label: "Próximo Encuentro", value: "Anunciar el próximo partido", icon: Calendar },
                    { label: "Comentario Entrenador", value: "Leer un comentario del entrenador", icon: MessageCircle },
                    { label: "Invitar a Hinchada", value: "Invitar a apoyar al equipo", icon: Flag }
                ]
            },
            {
                label: "Economía Doméstica",
                value: "Boletín sobre precios y mercado",
                icon: DollarSign,
                actions: [
                    { label: "Subida de Precio", value: "Informar subida de un producto", icon: TrendingUp },
                    { label: "Consejo de Ahorro", value: "Dar un consejo simple para ahorrar", icon: PiggyBank },
                    { label: "Comparar Precios", value: "Comparar precios entre mercados", icon: Scale },
                    { label: "Mercado del Día", value: "Describir productos del día", icon: Apple },
                    { label: "Entrevista a Comerciante", value: "Leer una frase de un comerciante", icon: MessageCircle }
                ]
            },
            {
                label: "Salud Pública",
                value: "Radio local recomendaciones de salud",
                icon: Stethoscope,
                actions: [
                    { label: "Campaña Vacunación", value: "Anunciar campaña de vacunación", icon: ShieldAlert },
                    { label: "Prevención", value: "Dar recomendaciones de prevención", icon: Hand },
                    { label: "Síntomas Básicos", value: "Mencionar síntomas básicos", icon: AlertCircle },
                    { label: "Lugar de Atención", value: "Indicar centros de atención", icon: MapPin },
                    { label: "Llamado a Calma", value: "Transmitir un mensaje de calma", icon: Heart }
                ]
            },
            {
                label: "Transporte Regional",
                value: "Noticias sobre buses y trenes",
                icon: Train,
                actions: [
                    { label: "Nuevo Horario", value: "Informar nuevo horario de buses", icon: Clock },
                    { label: "Huelga Parcial", value: "Avisar una huelga parcial", icon: AlertTriangle },
                    { label: "Venta de Billetes", value: "Explicar dónde comprar billetes", icon: Ticket },
                    { label: "Retrasos", value: "Reportar retrasos en rutas", icon: Watch },
                    { label: "Alternativas", value: "Sugerir rutas alternativas", icon: Map }
                ]
            },
            {
                label: "Clima Extremo",
                value: "Boletín de clima con alertas",
                icon: AlertOctagon,
                actions: [
                    { label: "Alerta", value: "Declarar alerta por calor o frío", icon: AlertOctagon },
                    { label: "Medidas Básicas", value: "Explicar medidas de protección", icon: ShieldAlert },
                    { label: "Impacto Escolar", value: "Informar cambios en escuelas", icon: School },
                    { label: "Hidratación", value: "Recomendar beber agua", icon: Droplet },
                    { label: "Actualización", value: "Anunciar actualización en horas", icon: Clock }
                ]
            }
        ],
        [Level.Intermediate]: [
            {
                label: "Política Municipal",
                value: "Radio ciudad debate en ayuntamiento",
                icon: Building,
                actions: [
                    { label: "Debate", value: "Resumir un debate municipal", icon: MessageCircle },
                    { label: "Cita de Concejal", value: "Leer una cita de un concejal", icon: FileText },
                    { label: "Proyecto Aprobado", value: "Anunciar un proyecto aprobado", icon: CheckCircle },
                    { label: "Posturas Opuestas", value: "Contrastar posturas políticas", icon: Scale },
                    { label: "Próximos Pasos", value: "Explicar próximos pasos", icon: ArrowRight }
                ]
            },
            {
                label: "Economía Nacional",
                value: "Boletín sobre economía y empleo",
                icon: PieChart,
                actions: [
                    { label: "Dato de Inflación", value: "Dar un dato de inflación", icon: TrendingUp },
                    { label: "Entrevista Experta", value: "Citar a un experto", icon: MessageCircle },
                    { label: "Impacto en Salarios", value: "Explicar impacto en salarios", icon: DollarSign },
                    { label: "Medida Gobierno", value: "Anunciar una medida oficial", icon: FileText },
                    { label: "Análisis Breve", value: "Hacer un análisis corto", icon: Brain }
                ]
            },
            {
                label: "Tecnología y Sociedad",
                value: "Noticias sobre tecnología y privacidad",
                icon: Laptop,
                actions: [
                    { label: "Nuevo Servicio", value: "Presentar un nuevo servicio digital", icon: Sparkles },
                    { label: "Riesgos Privacidad", value: "Explicar riesgos de privacidad", icon: Lock },
                    { label: "Declaración Empresa", value: "Leer comunicado de empresa", icon: FileText },
                    { label: "Reacción Usuarios", value: "Contar reacción de usuarios", icon: MessageCircle },
                    { label: "Consejo de Uso", value: "Dar consejo de uso seguro", icon: ShieldAlert }
                ]
            },
            {
                label: "Ciencia y Salud",
                value: "Boletín con noticias científicas",
                icon: FlaskConical,
                actions: [
                    { label: "Estudio Reciente", value: "Presentar un estudio reciente", icon: BookOpen },
                    { label: "Explicación", value: "Explicar el estudio en lenguaje claro", icon: Brain },
                    { label: "Aplicación", value: "Mencionar una aplicación práctica", icon: Wrench },
                    { label: "Advertencia", value: "Dar una advertencia", icon: AlertTriangle },
                    { label: "Fuente", value: "Citar la fuente del estudio", icon: FileText }
                ]
            },
            {
                label: "Medio Ambiente",
                value: "Noticias ambientales y emergencias",
                icon: TreePine,
                actions: [
                    { label: "Incendio", value: "Reportar un incendio forestal", icon: AlertTriangle },
                    { label: "Evacuación", value: "Informar estado de evacuación", icon: MapPin },
                    { label: "Bomberos", value: "Contar trabajo de bomberos", icon: FireExtinguisher },
                    { label: "Área Afectada", value: "Dar datos de área afectada", icon: Map },
                    { label: "Consejo Seguridad", value: "Dar consejos de seguridad", icon: ShieldAlert }
                ]
            },
            {
                label: "Tribunales",
                value: "Noticias de juicio en curso",
                icon: Gavel,
                actions: [
                    { label: "Resumen del Caso", value: "Resumir el caso judicial", icon: FileText },
                    { label: "Declaración Abogado", value: "Leer declaración del abogado", icon: MessageCircle },
                    { label: "Calendario", value: "Anunciar fechas del juicio", icon: Calendar },
                    { label: "Reacción Pública", value: "Explicar reacción del público", icon: Frown },
                    { label: "Siguiente Sesión", value: "Indicar próxima sesión", icon: Clock }
                ]
            },
            {
                label: "Economía Internacional",
                value: "Boletín sobre comercio exterior",
                icon: Globe,
                actions: [
                    { label: "Tipo de Cambio", value: "Dar el tipo de cambio actual", icon: Euro },
                    { label: "Comercio Exterior", value: "Explicar movimiento comercial", icon: Ship },
                    { label: "Impacto Importaciones", value: "Explicar impacto en importaciones", icon: TrendingUp },
                    { label: "Cita de Analista", value: "Citar un analista", icon: MessageCircle },
                    { label: "Resumen Final", value: "Cerrar con resumen claro", icon: CheckCircle }
                ]
            }
        ],
        [Level.Advanced]: [
            {
                label: "Última Hora",
                value: "Radio nacional noticias de última hora",
                icon: AlertOctagon,
                actions: [
                    { label: "Titular Urgente", value: "Leer un titular urgente", icon: Megaphone },
                    { label: "Confirmación Fuente", value: "Confirmar información con fuentes", icon: ShieldAlert },
                    { label: "Datos Preliminares", value: "Dar datos preliminares", icon: FileText },
                    { label: "Llamado Prudencia", value: "Pedir prudencia al público", icon: Hand },
                    { label: "Actualización", value: "Prometer actualización pronto", icon: Clock }
                ]
            },
            {
                label: "Cobertura de Crisis",
                value: "Cobertura en directo de crisis",
                icon: Siren,
                actions: [
                    { label: "Balance de Daños", value: "Dar balance de daños", icon: AlertTriangle },
                    { label: "Rueda de Prensa", value: "Resumir rueda de prensa", icon: Mic },
                    { label: "Recursos Desplegados", value: "Describir recursos desplegados", icon: Truck },
                    { label: "Testimonio", value: "Transmitir un testimonio en directo", icon: MessageCircle },
                    { label: "Plan de Contingencia", value: "Explicar plan de contingencia", icon: ShieldAlert }
                ]
            },
            {
                label: "Investigación Especial",
                value: "Informe de investigación periodística",
                icon: Search,
                actions: [
                    { label: "Corrupción", value: "Destapar un caso de corrupción", icon: AlertTriangle },
                    { label: "Documentos Filtrados", value: "Citar documentos filtrados", icon: FileText },
                    { label: "Respuesta Oficial", value: "Presentar la respuesta oficial", icon: MessageCircle },
                    { label: "Impacto Político", value: "Analizar impacto político", icon: Globe },
                    { label: "Próximas Revelaciones", value: "Adelantar futuras revelaciones", icon: Eye }
                ]
            },
            {
                label: "Entrevista en Directo",
                value: "Entrevista dura en directo",
                icon: Mic,
                actions: [
                    { label: "Pregunta Incómoda", value: "Hacer una pregunta difícil", icon: AlertTriangle },
                    { label: "Respuesta Evasiva", value: "Detectar una evasiva", icon: Eye },
                    { label: "Repregunta", value: "Hacer una repregunta firme", icon: Zap },
                    { label: "Dato Contrastado", value: "Citar un dato verificado", icon: CheckCircle },
                    { label: "Cierre con Titular", value: "Cerrar con una frase potente", icon: Megaphone }
                ]
            },
            {
                label: "Editorial del Día",
                value: "Editorial con opinión argumentada",
                icon: MessageCircle,
                actions: [
                    { label: "Opinión", value: "Dar una opinión clara", icon: ThumbsUp },
                    { label: "Ejemplo Histórico", value: "Citar un ejemplo histórico", icon: BookOpen },
                    { label: "Crítica", value: "Criticar una decisión política", icon: ThumbsDown },
                    { label: "Propuesta", value: "Proponer una alternativa", icon: Lightbulb },
                    { label: "Conclusión", value: "Cerrar con conclusión contundente", icon: Star }
                ]
            },
            {
                label: "Economía de Mercados",
                value: "Informe de mercados y bolsa",
                icon: LineChart,
                actions: [
                    { label: "Movimiento Bursátil", value: "Describir movimientos de bolsa", icon: TrendingUp },
                    { label: "Indicadores", value: "Leer indicadores clave", icon: PieChart },
                    { label: "Reacción Inversores", value: "Contar reacción de inversores", icon: MessageCircle },
                    { label: "Consejo Prudente", value: "Dar consejo prudente", icon: ShieldAlert },
                    { label: "Análisis de Riesgo", value: "Analizar riesgos", icon: AlertTriangle }
                ]
            },
            {
                label: "Geopolítica",
                value: "Informe internacional y diplomacia",
                icon: Globe,
                actions: [
                    { label: "Cumbre Internacional", value: "Resumir una cumbre internacional", icon: Map },
                    { label: "Declaración Conjunta", value: "Leer una declaración conjunta", icon: FileText },
                    { label: "Tensión Diplomática", value: "Explicar tensión diplomática", icon: AlertTriangle },
                    { label: "Reacción Países", value: "Describir reacciones", icon: Flag },
                    { label: "Proyección Futuro", value: "Proyectar escenarios", icon: Eye }
                ]
            },
            {
                label: "Cultura y Sociedad",
                value: "Debate cultural en radio",
                icon: Drama,
                actions: [
                    { label: "Censura", value: "Debatir sobre censura cultural", icon: Ban },
                    { label: "Impacto Artistas", value: "Explicar impacto en artistas", icon: Palette },
                    { label: "Opiniones Contrapuestas", value: "Comparar opiniones distintas", icon: Scale },
                    { label: "Contexto Histórico", value: "Dar contexto histórico", icon: BookOpen },
                    { label: "Cierre Reflexivo", value: "Cerrar con reflexión", icon: Brain }
                ]
            }
        ]
    },
    [TextType.Monologue]: {
        [Level.Intro]: [
            {
                label: "Mi Día de Hoy",
                value: "Monólogo simple sobre el día",
                icon: Sun,
                actions: [
                    { label: "Mañana", value: "Describir la mañana", icon: Sun },
                    { label: "Tarde", value: "Contar qué hizo por la tarde", icon: Clock },
                    { label: "Comida", value: "Mencionar qué comió", icon: Coffee },
                    { label: "Algo Divertido", value: "Contar algo divertido", icon: Smile },
                    { label: "Despedida", value: "Cerrar el monólogo", icon: ThumbsUp }
                ]
            },
            {
                label: "Mi Familia",
                value: "Monólogo sobre la familia",
                icon: Heart,
                actions: [
                    { label: "Presentar Familia", value: "Decir cuántos son en la familia", icon: UserPlus },
                    { label: "Describir a Alguien", value: "Describir a una persona", icon: Smile },
                    { label: "Actividad Juntos", value: "Contar una actividad familiar", icon: Home },
                    { label: "Edades", value: "Mencionar edades", icon: Hash },
                    { label: "Gustos", value: "Decir qué le gusta de su familia", icon: Heart }
                ]
            },
            {
                label: "Mi Barrio",
                value: "Monólogo sobre el barrio",
                icon: Map,
                actions: [
                    { label: "Descripción", value: "Describir el barrio", icon: MapPin },
                    { label: "Tiendas", value: "Mencionar tiendas importantes", icon: ShoppingBag },
                    { label: "Cómo Llegar", value: "Explicar cómo llegar", icon: Map },
                    { label: "Lugar Favorito", value: "Contar un lugar favorito", icon: Star },
                    { label: "Problema Simple", value: "Contar un problema pequeño", icon: AlertCircle }
                ]
            },
            {
                label: "Mi Mascota",
                value: "Monólogo sobre una mascota",
                icon: Dog,
                actions: [
                    { label: "Presentar Mascota", value: "Decir nombre y tipo", icon: Dog },
                    { label: "Rutina", value: "Contar su rutina", icon: Clock },
                    { label: "Lo que le Gusta", value: "Decir lo que le gusta", icon: Heart },
                    { label: "Problema Pequeño", value: "Contar un problema simple", icon: AlertTriangle },
                    { label: "Consejo Cuidado", value: "Dar un consejo para cuidarla", icon: Hand }
                ]
            },
            {
                label: "Recuerdo Feliz",
                value: "Monólogo sobre un recuerdo feliz",
                icon: Smile,
                actions: [
                    { label: "Lugar del Recuerdo", value: "Decir dónde fue", icon: MapPin },
                    { label: "Quién Estaba", value: "Mencionar personas presentes", icon: UserPlus },
                    { label: "Qué Pasó", value: "Contar lo que pasó", icon: MessageCircle },
                    { label: "Cómo Me Sentí", value: "Expresar emociones simples", icon: Heart },
                    { label: "Por Qué Especial", value: "Explicar por qué es especial", icon: Star }
                ]
            }
        ],
        [Level.Beginner]: [
            {
                label: "Viaje Corto",
                value: "Relato de viaje breve",
                icon: Plane,
                actions: [
                    { label: "Planificación", value: "Contar cómo planeó el viaje", icon: Calendar },
                    { label: "Transporte", value: "Decir cómo llegó", icon: Train },
                    { label: "Lugar Visitado", value: "Describir un lugar visitado", icon: MapPin },
                    { label: "Problema", value: "Contar un problema pequeño", icon: AlertTriangle },
                    { label: "Recomendación", value: "Dar un consejo para otros", icon: ThumbsUp }
                ]
            },
            {
                label: "Primer Trabajo/Clase",
                value: "Relato de primera experiencia",
                icon: Briefcase,
                actions: [
                    { label: "Contexto", value: "Explicar cómo empezó", icon: BookOpen },
                    { label: "Tarea Principal", value: "Describir la tarea principal", icon: Hand },
                    { label: "Persona Conocida", value: "Mencionar a alguien importante", icon: UserPlus },
                    { label: "Dificultad", value: "Contar una dificultad", icon: AlertCircle },
                    { label: "Lección", value: "Explicar lo aprendido", icon: Lightbulb }
                ]
            },
            {
                label: "Día Difícil",
                value: "Monólogo sobre un día complicado",
                icon: Frown,
                actions: [
                    { label: "Qué Salió Mal", value: "Explicar qué fue mal", icon: AlertTriangle },
                    { label: "Cómo Lo Resolví", value: "Contar la solución", icon: Wrench },
                    { label: "Ayuda Recibida", value: "Mencionar ayuda", icon: Hand },
                    { label: "Sentimientos", value: "Expresar emociones", icon: Heart },
                    { label: "Resultado", value: "Decir cómo terminó", icon: CheckCircle }
                ]
            },
            {
                label: "Receta en Casa",
                value: "Monólogo explicando receta sencilla",
                icon: Utensils,
                actions: [
                    { label: "Ingredientes", value: "Listar ingredientes básicos", icon: Menu },
                    { label: "Pasos", value: "Explicar pasos simples", icon: Hand },
                    { label: "Tiempo", value: "Decir tiempo de preparación", icon: Clock },
                    { label: "Consejo", value: "Dar un consejo de cocina", icon: Smile },
                    { label: "Resultado", value: "Describir el resultado", icon: Star }
                ]
            },
            {
                label: "Una Amistad",
                value: "Relato sobre amistad",
                icon: HeartHandshake,
                actions: [
                    { label: "Cómo Se Conocieron", value: "Contar cómo se conocieron", icon: UserPlus },
                    { label: "Actividad Favorita", value: "Describir actividad favorita", icon: Smile },
                    { label: "Conflicto Pequeño", value: "Contar un conflicto", icon: AlertCircle },
                    { label: "Solución", value: "Explicar cómo lo resolvieron", icon: CheckCircle },
                    { label: "Importancia", value: "Decir por qué es importante", icon: Heart }
                ]
            },
            {
                label: "Evento Cultural",
                value: "Monólogo sobre evento cultural",
                icon: Music,
                actions: [
                    { label: "Dónde Fue", value: "Decir dónde fue", icon: MapPin },
                    { label: "Qué Vi", value: "Describir lo que vio", icon: Eye },
                    { label: "Qué Me Gustó", value: "Decir qué le gustó", icon: ThumbsUp },
                    { label: "Qué No", value: "Decir qué no le gustó", icon: ThumbsDown },
                    { label: "Invitación", value: "Invitar a otros", icon: Ticket }
                ]
            }
        ],
        [Level.Intermediate]: [
            {
                label: "Decisión Importante",
                value: "Monólogo sobre una decisión",
                icon: Scale,
                actions: [
                    { label: "Contexto", value: "Explicar el contexto", icon: FileText },
                    { label: "Opciones", value: "Presentar opciones", icon: Scale },
                    { label: "Dudas", value: "Expresar dudas", icon: Frown },
                    { label: "Decisión", value: "Contar la decisión final", icon: CheckCircle },
                    { label: "Consecuencia", value: "Explicar la consecuencia", icon: ArrowRight }
                ]
            },
            {
                label: "Problema y Solución",
                value: "Relato de un problema complejo",
                icon: AlertTriangle,
                actions: [
                    { label: "Problema", value: "Describir el problema", icon: AlertTriangle },
                    { label: "Pasos", value: "Explicar los pasos para resolverlo", icon: ListChecks },
                    { label: "Obstáculo", value: "Mencionar un obstáculo", icon: X },
                    { label: "Resultado", value: "Contar el resultado", icon: CheckCircle },
                    { label: "Reflexión", value: "Reflexionar sobre lo aprendido", icon: Brain }
                ]
            },
            {
                label: "Historia de Superación",
                value: "Monólogo sobre superación",
                icon: TrendingUp,
                actions: [
                    { label: "Dificultad", value: "Describir dificultad inicial", icon: AlertCircle },
                    { label: "Esfuerzo", value: "Contar el esfuerzo", icon: Dumbbell },
                    { label: "Apoyo", value: "Mencionar apoyo recibido", icon: Heart },
                    { label: "Logro", value: "Describir el logro", icon: Star },
                    { label: "Aprendizaje", value: "Cierre con aprendizaje", icon: Lightbulb }
                ]
            },
            {
                label: "Relato de Ciudad",
                value: "Monólogo sobre cambios en la ciudad",
                icon: Building,
                actions: [
                    { label: "Cambio", value: "Explicar un cambio reciente", icon: Sparkles },
                    { label: "Causa", value: "Describir causas", icon: Search },
                    { label: "Reacción", value: "Contar reacción de la gente", icon: MessageCircle },
                    { label: "Balance", value: "Hablar de beneficios y problemas", icon: Scale },
                    { label: "Deseo Futuro", value: "Expresar un deseo futuro", icon: Star }
                ]
            },
            {
                label: "Crónica de Evento",
                value: "Relato cronológico de un evento",
                icon: Calendar,
                actions: [
                    { label: "Inicio", value: "Describir el inicio", icon: Flag },
                    { label: "Momento Clave", value: "Narrar el momento clave", icon: Zap },
                    { label: "Ambiente", value: "Describir el ambiente", icon: Music },
                    { label: "Opinión", value: "Dar opinión personal", icon: ThumbsUp },
                    { label: "Conclusión", value: "Cerrar la crónica", icon: CheckCircle }
                ]
            },
            {
                label: "Reflexión Cultural",
                value: "Monólogo sobre cultura y tradición",
                icon: Palette,
                actions: [
                    { label: "Tradición", value: "Explicar una tradición", icon: BookOpen },
                    { label: "Valor Cultural", value: "Describir su valor", icon: Heart },
                    { label: "Cambio Generacional", value: "Comparar generaciones", icon: Scale },
                    { label: "Experiencia", value: "Contar experiencia personal", icon: MessageCircle },
                    { label: "Conclusión", value: "Cerrar con reflexión", icon: Brain }
                ]
            },
            {
                label: "Carta Abierta",
                value: "Monólogo en forma de carta",
                icon: FileText,
                actions: [
                    { label: "Destinatario", value: "Decir a quién va la carta", icon: UserPlus },
                    { label: "Motivo", value: "Explicar el motivo", icon: MessageCircle },
                    { label: "Argumento", value: "Desarrollar argumento principal", icon: Scale },
                    { label: "Ejemplo", value: "Dar un ejemplo concreto", icon: Search },
                    { label: "Cierre Emotivo", value: "Cerrar con tono emotivo", icon: Heart }
                ]
            }
        ],
        [Level.Advanced]: [
            {
                label: "Ensayo Personal",
                value: "Monólogo con tesis y argumentos",
                icon: FileText,
                actions: [
                    { label: "Tesis", value: "Presentar una tesis personal", icon: Lightbulb },
                    { label: "Argumento", value: "Desarrollar argumento principal", icon: Scale },
                    { label: "Contraargumento", value: "Incluir contraargumento", icon: X },
                    { label: "Ejemplo", value: "Dar un ejemplo claro", icon: Search },
                    { label: "Cierre", value: "Cerrar con conclusión", icon: CheckCircle }
                ]
            },
            {
                label: "Confesión y Catarsis",
                value: "Monólogo íntimo de confesión",
                icon: Heart,
                actions: [
                    { label: "Confesión", value: "Confesar un hecho", icon: Lock },
                    { label: "Contexto Emocional", value: "Explicar emociones", icon: Frown },
                    { label: "Consecuencias", value: "Describir consecuencias", icon: AlertTriangle },
                    { label: "Responsabilidad", value: "Asumir responsabilidad", icon: Hand },
                    { label: "Aprendizaje", value: "Cerrar con aprendizaje", icon: Star }
                ]
            },
            {
                label: "Crónica de Investigación",
                value: "Monólogo investigativo",
                icon: Search,
                actions: [
                    { label: "Inicio", value: "Explicar cómo empezó", icon: Flag },
                    { label: "Fuentes", value: "Describir fuentes consultadas", icon: FileText },
                    { label: "Hallazgo", value: "Revelar hallazgo clave", icon: Sparkles },
                    { label: "Reacción", value: "Contar reacciones", icon: MessageCircle },
                    { label: "Conclusión", value: "Cerrar con conclusión", icon: CheckCircle }
                ]
            },
            {
                label: "Relato Literario",
                value: "Monólogo narrativo literario",
                icon: BookOpen,
                actions: [
                    { label: "Inicio Atmosférico", value: "Crear ambiente inicial", icon: Moon },
                    { label: "Giro Inesperado", value: "Narrar un giro", icon: Zap },
                    { label: "Personaje", value: "Desarrollar personaje", icon: UserPlus },
                    { label: "Clímax", value: "Narrar clímax", icon: AlertTriangle },
                    { label: "Final Abierto", value: "Cerrar con final abierto", icon: Eye }
                ]
            },
            {
                label: "Discurso Motivacional",
                value: "Monólogo motivacional",
                icon: Megaphone,
                actions: [
                    { label: "Historia Personal", value: "Contar historia personal", icon: Heart },
                    { label: "Obstáculo", value: "Describir un obstáculo", icon: AlertCircle },
                    { label: "Mensaje Inspirador", value: "Dar mensaje inspirador", icon: Sparkles },
                    { label: "Llamado a la Acción", value: "Invitar a actuar", icon: ArrowRight },
                    { label: "Cierre Potente", value: "Cerrar con frase potente", icon: Star }
                ]
            },
            {
                label: "Análisis Social",
                value: "Monólogo de análisis social",
                icon: Globe,
                actions: [
                    { label: "Problema Social", value: "Describir un problema social", icon: AlertTriangle },
                    { label: "Datos", value: "Mencionar datos o evidencia", icon: PieChart },
                    { label: "Causas", value: "Analizar causas estructurales", icon: Brain },
                    { label: "Impacto Humano", value: "Hablar del impacto humano", icon: Heart },
                    { label: "Propuesta", value: "Proponer una acción", icon: Lightbulb }
                ]
            },
            {
                label: "Memoria Histórica",
                value: "Monólogo sobre memoria histórica",
                icon: BookOpen,
                actions: [
                    { label: "Contexto", value: "Dar contexto histórico", icon: Calendar },
                    { label: "Testimonio", value: "Citar un testimonio", icon: MessageCircle },
                    { label: "Detalle Simbólico", value: "Describir un símbolo", icon: Star },
                    { label: "Reflexión", value: "Reflexionar sobre el pasado", icon: Brain },
                    { label: "Lección", value: "Extraer una lección", icon: Lightbulb }
                ]
            },
            {
                label: "Monólogo Humorístico",
                value: "Monólogo con humor",
                icon: Smile,
                actions: [
                    { label: "Tema Cotidiano", value: "Elegir un tema cotidiano", icon: Home },
                    { label: "Exageración", value: "Usar exageración", icon: Zap },
                    { label: "Comparación", value: "Hacer una comparación graciosa", icon: Scale },
                    { label: "Remate", value: "Preparar el remate", icon: Megaphone },
                    { label: "Cierre", value: "Cerrar con broma", icon: ThumbsUp }
                ]
            }
        ]
    }
};
